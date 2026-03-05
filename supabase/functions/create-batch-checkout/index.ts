// Create Batch Checkout Edge Function
// Creates multiple orders and a SINGLE PayMongo Checkout Session for all of them.
// NOTE: For weekly pre-orders, use create-weekly-checkout instead.
// This function is kept for backwards compatibility.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import {
  createCheckoutSession,
  toCentavos,
  mapPaymentMethodTypes,
  buildCheckoutUrls,
} from '../_shared/paymongo.ts';

// Helper to get today's date in Philippines timezone (UTC+8)
function getTodayPhilippines(): string {
  const now = new Date();
  const phTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  return phTime.toISOString().split('T')[0];
}

interface OrderItem {
  product_id: string;
  quantity: number;
  price_at_order: number;
  meal_period?: string;
}

interface OrderGroup {
  student_id: string;
  client_order_id: string;
  items: OrderItem[];
  scheduled_for?: string;
}

interface BatchCheckoutRequest {
  parent_id: string;
  orders: OrderGroup[];
  payment_method: 'gcash' | 'paymaya' | 'card';
  notes?: string;
}

const ONLINE_PAYMENT_TIMEOUT_MINUTES = 30;

function errorResponse(corsHeaders: Record<string, string>, status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return new Response(
    JSON.stringify({ error: code, message, ...extra }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  const preflightResponse = handleCorsPreflight(req);
  if (preflightResponse) return preflightResponse;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return errorResponse(corsHeaders, 500, 'CONFIG_ERROR', 'Server configuration error');
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // ── Auth ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse(corsHeaders, 401, 'UNAUTHORIZED', 'Missing or invalid authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return errorResponse(corsHeaders, 401, 'UNAUTHORIZED', 'Session expired or invalid. Please sign in again.');
    }

    if (user.app_metadata?.role !== 'parent') {
      return errorResponse(corsHeaders, 403, 'FORBIDDEN', 'Only parents can place orders');
    }

    // ── Parse request ──
    const body: BatchCheckoutRequest = await req.json();
    const { parent_id, orders, payment_method, notes } = body;

    if (parent_id !== user.id) {
      return errorResponse(corsHeaders, 403, 'FORBIDDEN', 'Cannot place orders on behalf of another user');
    }

    if (!parent_id || !orders || orders.length === 0) {
      return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', 'Missing required fields');
    }

    if (orders.length > 20) {
      return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', 'Too many orders in a single batch (max 20)');
    }

    const validOnlineMethods = ['gcash', 'paymaya', 'card'];
    if (!validOnlineMethods.includes(payment_method)) {
      return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', `Invalid online payment method: ${payment_method}. Use process-batch-order for cash.`);
    }

    // Validate each order group has required fields
    for (const order of orders) {
      if (!order.student_id || !order.client_order_id || !order.items || order.items.length === 0) {
        return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', 'Each order must have student_id, client_order_id, and items');
      }
      for (const item of order.items) {
        if (!item.product_id || item.quantity <= 0 || item.price_at_order < 0) {
          return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', 'Invalid item in order');
        }
      }
    }

    console.log('Creating batch checkout:', { parent_id, order_count: orders.length, payment_method });

    // ── System settings checks ──
    const { data: settingsData } = await supabaseAdmin.from('system_settings').select('key, value');
    const settings = new Map<string, unknown>();
    settingsData?.forEach(s => settings.set(s.key, s.value));

    if (settings.get('maintenance_mode') === true) {
      return errorResponse(corsHeaders, 503, 'MAINTENANCE_MODE', 'The canteen is currently under maintenance.');
    }

    const now = new Date();
    const phTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const currentTimeStr = phTime.toISOString().substring(11, 16);
    const todayStr = getTodayPhilippines();

    const operatingHours = settings.get('operating_hours') as { open?: string; close?: string } | undefined;
    const orderCutoffTime = settings.get('order_cutoff_time') as string | undefined;
    const allowFutureOrders = settings.get('allow_future_orders') !== false;
    const maxFutureDays = (settings.get('max_future_days') as number) || 5;

    // Get holidays once
    const { data: holidays } = await supabaseAdmin.from('holidays').select('id, name, date, is_recurring');

    // ── Validate dates for all orders ──
    const uniqueDates = [...new Set(orders.map(o => o.scheduled_for || todayStr))];
    for (const orderDate of uniqueDates) {
      const isToday = orderDate === todayStr;

      if (isToday && operatingHours?.open && operatingHours?.close) {
        if (currentTimeStr < operatingHours.open || currentTimeStr > operatingHours.close) {
          return errorResponse(corsHeaders, 400, 'OUTSIDE_HOURS', `Orders can only be placed between ${operatingHours.open} and ${operatingHours.close}.`);
        }
      }

      const orderDateObj = new Date(orderDate + 'T00:00:00');
      const dayOfWeek = orderDateObj.getDay();

      if (dayOfWeek === 0) {
        return errorResponse(corsHeaders, 400, 'INVALID_DATE', 'The canteen is closed on Sundays.');
      }

      if (dayOfWeek === 6) {
        const { data: makeupDay } = await supabaseAdmin.from('makeup_days').select('id').eq('date', orderDate).single();
        if (!makeupDay) {
          return errorResponse(corsHeaders, 400, 'INVALID_DATE', 'The canteen is closed on regular Saturdays.');
        }
      }

      const holiday = holidays?.find(h => {
        const hd = h.date.split('T')[0];
        return h.is_recurring ? hd.slice(5) === orderDate.slice(5) : hd === orderDate;
      });
      if (holiday) {
        return errorResponse(corsHeaders, 400, 'HOLIDAY', `The canteen is closed on ${holiday.name}.`);
      }

      if (isToday && orderCutoffTime && currentTimeStr > orderCutoffTime) {
        return errorResponse(corsHeaders, 400, 'PAST_CUTOFF', `Order cutoff time (${orderCutoffTime}) has passed.`);
      }

      if (!isToday) {
        if (!allowFutureOrders) {
          return errorResponse(corsHeaders, 400, 'FUTURE_ORDERS_DISABLED', 'Future orders are currently not allowed.');
        }
        const todayDateObj = new Date(todayStr + 'T00:00:00');
        const daysDiff = Math.ceil((orderDateObj.getTime() - todayDateObj.getTime()) / 86400000);
        if (daysDiff > maxFutureDays) {
          return errorResponse(corsHeaders, 400, 'ORDER_TOO_FAR', `Orders can only be placed up to ${maxFutureDays} days in advance.`);
        }
        if (daysDiff < 0) {
          return errorResponse(corsHeaders, 400, 'PAST_DATE', 'Cannot place orders for past dates.');
        }
      }
    }

    // ── Verify parent-student links ──
    const uniqueStudentIds = [...new Set(orders.map(o => o.student_id))];
    const { data: studentLinks, error: linkError } = await supabaseAdmin
      .from('parent_students')
      .select('student_id')
      .eq('parent_id', parent_id)
      .in('student_id', uniqueStudentIds);

    if (linkError) {
      return errorResponse(corsHeaders, 500, 'SERVER_ERROR', 'Failed to verify student links');
    }

    const linkedStudents = new Set(studentLinks?.map(l => l.student_id) || []);
    for (const sid of uniqueStudentIds) {
      if (!linkedStudents.has(sid)) {
        return errorResponse(corsHeaders, 401, 'UNAUTHORIZED', 'Parent is not linked to this student');
      }
    }

    // ── Idempotency: check for existing client_order_ids ──
    const allClientOrderIds = orders.map(o => o.client_order_id);
    const { data: existingOrders } = await supabaseAdmin
      .from('orders')
      .select('id, client_order_id, status, paymongo_checkout_id, payment_group_id')
      .in('client_order_id', allClientOrderIds);

    if (existingOrders && existingOrders.length > 0) {
      // If all existing orders share a payment_group_id and are awaiting payment, return existing checkout
      const awaitingOrders = existingOrders.filter(o => o.status === 'awaiting_payment' && o.payment_group_id);
      if (awaitingOrders.length > 0) {
        const groupId = awaitingOrders[0].payment_group_id;
        // Find one with a checkout ID
        const withCheckout = awaitingOrders.find(o => o.paymongo_checkout_id);
        if (withCheckout) {
          try {
            const { getCheckoutSession: getSession } = await import('../_shared/paymongo.ts');
            const session = await getSession(withCheckout.paymongo_checkout_id!);
            return new Response(
              JSON.stringify({
                success: true,
                payment_group_id: groupId,
                order_ids: awaitingOrders.map(o => o.id),
                checkout_url: session.attributes.checkout_url,
                payment_due_at: new Date(Date.now() + ONLINE_PAYMENT_TIMEOUT_MINUTES * 60 * 1000).toISOString(),
              }),
              { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
          } catch {
            // Session expired — fall through
          }
        }
      }

      // Some orders already exist with different states
      return errorResponse(corsHeaders, 409, 'DUPLICATE_ORDER', 'One or more orders already exist', {
        existing_order_ids: existingOrders.map(o => o.id),
      });
    }

    // ── Duplicate slot check (student_id × scheduled_for) ──
    const slotChecks = orders.map(o => ({
      student_id: o.student_id,
      scheduled_for: o.scheduled_for || todayStr,
    }));

    const { data: conflicting } = await supabaseAdmin
      .from('orders')
      .select('id, student_id, scheduled_for, status')
      .in('student_id', [...new Set(slotChecks.map(s => s.student_id))])
      .in('scheduled_for', [...new Set(slotChecks.map(s => s.scheduled_for))])
      .not('status', 'eq', 'cancelled');

    const slotConflicts = conflicting?.filter(existing =>
      slotChecks.some(s =>
        s.student_id === existing.student_id &&
        s.scheduled_for === existing.scheduled_for
      )
    ) || [];

    // Phase 4: Auto-merge — instead of DUPLICATE_SLOT, merge items into existing orders
    const mergedOrderIds: string[] = [];
    let newOrders = [...orders];

    if (slotConflicts.length > 0) {
      const mergeableStatuses = ['pending', 'awaiting_payment'];
      const unmergeable = slotConflicts.filter(c => !mergeableStatuses.includes(c.status));
      if (unmergeable.length > 0) {
        return errorResponse(corsHeaders, 409, 'ORDER_LOCKED',
          `Order for this student and date is already ${unmergeable[0].status}. Cannot add items.`,
          { order_id: unmergeable[0].id, status: unmergeable[0].status }
        );
      }

      const mergeNewOrders: typeof orders = [];
      for (const order of orders) {
        const existingOrder = slotConflicts.find(c =>
          c.student_id === order.student_id &&
          c.scheduled_for === (order.scheduled_for || todayStr)
        );

        if (existingOrder) {
          // MERGE: append items to existing order
          const newItems = order.items.map(item => ({
            order_id: existingOrder.id,
            product_id: item.product_id,
            quantity: item.quantity,
            price_at_order: item.price_at_order,
            meal_period: item.meal_period || 'lunch',
          }));

          const { error: itemsErr } = await supabaseAdmin
            .from('order_items').insert(newItems);

          if (itemsErr) {
            console.error('Error merging items:', itemsErr);
            return errorResponse(corsHeaders, 500, 'MERGE_FAILED', 'Failed to add items to existing order.');
          }

          // Recalculate total from all confirmed items
          const { data: allItems } = await supabaseAdmin
            .from('order_items')
            .select('price_at_order, quantity')
            .eq('order_id', existingOrder.id)
            .eq('status', 'confirmed');

          const newTotal = (allItems || []).reduce((s: number, i: any) => s + Number(i.price_at_order) * i.quantity, 0);

          await supabaseAdmin.from('orders')
            .update({ total_amount: newTotal })
            .eq('id', existingOrder.id);

          mergedOrderIds.push(existingOrder.id);
        } else {
          mergeNewOrders.push(order);
        }
      }
      newOrders = mergeNewOrders;
    }

    // ── Validate all products and stock across all orders (including merged) ──
    const allProductIds = [...new Set(orders.flatMap(o => o.items.map(i => i.product_id)))];
    const { data: products, error: productsError } = await supabaseAdmin
      .from('products')
      .select('id, name, price, available')
      .in('id', allProductIds);

    if (productsError || !products) {
      return errorResponse(corsHeaders, 500, 'SERVER_ERROR', 'Failed to fetch products');
    }

    const productMap = new Map(products.map(p => [p.id, p]));

    // Aggregate demand per product across all orders (including merged — stock was already reserved for merged items above)
    const totalDemand = new Map<string, number>();
    for (const order of newOrders) {
      for (const item of order.items) {
        totalDemand.set(item.product_id, (totalDemand.get(item.product_id) || 0) + item.quantity);
      }
    }

    // Build combined line items for PayMongo (only new orders)
    let grandTotal = 0;
    const lineItems: Array<{ name: string; quantity: number; amount: number; currency: string }> = [];

    // Per-order line item tracking for DB insert
    const orderLineItems: Map<string, Array<{ name: string; quantity: number; amount: number }>> = new Map();

    for (const order of newOrders) {
      const key = order.client_order_id;
      orderLineItems.set(key, []);
      let orderTotal = 0;

      for (const item of order.items) {
        const product = productMap.get(item.product_id);
        if (!product) {
          return errorResponse(corsHeaders, 400, 'PRODUCT_NOT_FOUND', 'Product not found', { product_id: item.product_id });
        }
        if (!product.available) {
          return errorResponse(corsHeaders, 400, 'PRODUCT_UNAVAILABLE', `'${product.name}' is not available`);
        }
        if (Math.abs(item.price_at_order - product.price) > 0.01) {
          return errorResponse(corsHeaders, 400, 'PRICE_MISMATCH', `Price changed for '${product.name}'. Please refresh.`);
        }
        orderTotal += product.price * item.quantity;
        orderLineItems.get(key)!.push({
          name: product.name,
          quantity: item.quantity,
          amount: toCentavos(product.price),
        });
      }

      grandTotal += orderTotal;
    }

    // If ALL orders were merged, no PayMongo checkout needed — return success immediately
    if (newOrders.length === 0) {
      console.log('All orders merged into existing orders:', { merged_order_ids: mergedOrderIds });
      return new Response(
        JSON.stringify({
          success: true,
          order_ids: mergedOrderIds,
          merged_order_ids: mergedOrderIds,
          merged: true,
          total_amount: 0,
          message: `Items merged into ${mergedOrderIds.length} existing order(s).`,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // PayMongo minimum
    if (grandTotal < 20) {
      return errorResponse(corsHeaders, 400, 'MINIMUM_AMOUNT', 'Minimum order amount is ₱20 for online payment.');
    }

    // Build combined line items for PayMongo (aggregate by product name, new orders only)
    const combinedItems = new Map<string, { name: string; quantity: number; amount: number }>();
    for (const order of newOrders) {
      for (const item of order.items) {
        const product = productMap.get(item.product_id)!;
        const existing = combinedItems.get(product.id);
        if (existing) {
          existing.quantity += item.quantity;
        } else {
          combinedItems.set(product.id, {
            name: product.name,
            quantity: item.quantity,
            amount: toCentavos(product.price),
          });
        }
      }
    }

    for (const item of combinedItems.values()) {
      lineItems.push({ ...item, currency: 'PHP' });
    }

    // ── Create all orders in DB (batch insert) ──
    const paymentGroupId = crypto.randomUUID();
    const paymentDueAt = new Date(Date.now() + ONLINE_PAYMENT_TIMEOUT_MINUTES * 60 * 1000).toISOString();

    // Get student names for PayMongo description
    const { data: studentsData } = await supabaseAdmin
      .from('students')
      .select('id, first_name')
      .in('id', uniqueStudentIds);
    const studentNameMap = new Map(studentsData?.map(s => [s.id, s.first_name]) || []);

    // Build all order rows for batch insert (new orders only)
    const orderRows = newOrders.map(order => {
      const orderTotal = order.items.reduce((sum, item) => {
        const product = productMap.get(item.product_id)!;
        return sum + product.price * item.quantity;
      }, 0);

      return {
        parent_id,
        student_id: order.student_id,
        client_order_id: order.client_order_id,
        status: 'awaiting_payment',
        payment_status: 'awaiting_payment',
        payment_due_at: paymentDueAt,
        total_amount: orderTotal,
        payment_method,
        notes: notes || null,
        scheduled_for: order.scheduled_for || todayStr,
        payment_group_id: paymentGroupId,
      };
    });

    // Single batch insert for all orders
    const { data: createdOrders, error: ordersError } = await supabaseAdmin
      .from('orders')
      .insert(orderRows)
      .select('id, client_order_id, total_amount');

    if (ordersError || !createdOrders || createdOrders.length === 0) {
      console.error('Batch order insert error:', ordersError);
      return errorResponse(corsHeaders, 500, 'ORDER_CREATION_FAILED', 'Failed to create orders');
    }

    const orderIdMap = new Map(createdOrders.map(o => [o.client_order_id, o.id]));
    const createdOrderIds = createdOrders.map(o => o.id);

    // Build all order_items rows for batch insert (new orders only)
    const allOrderItems = newOrders.flatMap(order => {
      const dbOrderId = orderIdMap.get(order.client_order_id);
      if (!dbOrderId) return [];
      return order.items.map(item => ({
        order_id: dbOrderId,
        product_id: item.product_id,
        quantity: item.quantity,
        price_at_order: item.price_at_order,
        meal_period: item.meal_period || 'lunch',
      }));
    });

    const { error: itemsError } = await supabaseAdmin.from('order_items').insert(allOrderItems);
    if (itemsError) {
      console.error('Batch order items insert error:', itemsError);
      // Rollback: delete all created orders (cascade deletes items)
      await supabaseAdmin.from('orders').delete().in('id', createdOrderIds);
      return errorResponse(corsHeaders, 500, 'ORDER_ITEMS_FAILED', 'Failed to create order items');
    }

    // Insert ONE pending payment for the entire batch (payment-centric model)
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from('payments')
      .insert({
        parent_id,
        type: 'payment',
        amount_total: grandTotal,
        method: payment_method,
        status: 'pending',
        payment_group_id: paymentGroupId,
      })
      .select('id')
      .single();

    if (paymentError || !payment) {
      console.error('Payment insert error (non-fatal):', paymentError);
    } else {
      // Link payment to each order via allocations
      const allAllocations = createdOrders.map(o => ({
        payment_id: payment.id,
        order_id: o.id,
        allocated_amount: o.total_amount,
      }));

      const { error: allocError } = await supabaseAdmin
        .from('payment_allocations')
        .insert(allAllocations);
      if (allocError) {
        console.error('Payment allocations insert error (non-fatal):', allocError);
      }
    }

    // ── Create SINGLE PayMongo Checkout Session for all orders ──
    let checkoutSession;
    try {
      // Use the payment_group_id as the reference for success/cancel URLs
      const appUrl = Deno.env.get('APP_URL') || 'http://localhost:5173';
      const successUrl = `${appUrl}/order-confirmation?payment=success&payment_group=${paymentGroupId}&order_id=${createdOrderIds[0]}`;
      const cancelUrl = `${appUrl}/order-confirmation?payment=cancelled&payment_group=${paymentGroupId}&order_id=${createdOrderIds[0]}`;

      // Build description
      const studentNames = uniqueStudentIds.map(id => studentNameMap.get(id) || 'Student').join(', ');
      const description = orders.length === 1
        ? 'LOHECA Canteen Order'
        : `LOHECA Canteen — ${orders.length} orders for ${studentNames}`;

      checkoutSession = await createCheckoutSession({
        lineItems,
        paymentMethodTypes: mapPaymentMethodTypes(payment_method),
        description,
        metadata: {
          type: 'order',
          order_id: createdOrderIds[0], // Primary order for backwards compat
          parent_id,
          client_order_id: orders[0].client_order_id,
          payment_group_id: paymentGroupId,
        },
        successUrl,
        cancelUrl,
      });

      // Save checkout ID on ALL orders in the batch (not just the first)
      await supabaseAdmin
        .from('orders')
        .update({ paymongo_checkout_id: checkoutSession.id })
        .eq('payment_group_id', paymentGroupId);

    } catch (paymongoErr) {
      console.error('PayMongo checkout creation failed:', paymongoErr);
      // Rollback everything using batch deletes
      await supabaseAdmin.from('order_items').delete().in('order_id', createdOrderIds);
      if (payment) {
        await supabaseAdmin.from('payment_allocations').delete().eq('payment_id', payment.id);
        await supabaseAdmin.from('payments').delete().eq('id', payment.id);
      }
      await supabaseAdmin.from('orders').delete().in('id', createdOrderIds);
      return errorResponse(corsHeaders, 502, 'PAYMENT_ERROR', 'Online payments are temporarily unavailable. Please try cash payment.');
    }

    console.log('Batch checkout created:', {
      payment_group_id: paymentGroupId,
      order_count: createdOrderIds.length,
      merged_count: mergedOrderIds.length,
      checkout_id: checkoutSession.id,
      total: grandTotal,
    });

    const allOrderIds = [...mergedOrderIds, ...createdOrderIds];

    return new Response(
      JSON.stringify({
        success: true,
        payment_group_id: paymentGroupId,
        order_ids: allOrderIds,
        merged_order_ids: mergedOrderIds.length > 0 ? mergedOrderIds : undefined,
        new_order_ids: createdOrderIds,
        merged: mergedOrderIds.length > 0,
        checkout_url: checkoutSession.attributes.checkout_url,
        payment_due_at: paymentDueAt,
        total_amount: grandTotal,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'SERVER_ERROR', message: 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
