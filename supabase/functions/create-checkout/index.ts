// Create Checkout Edge Function
// Creates a PayMongo Checkout Session for GCash, PayMaya, or Card orders
// The order is created with 'awaiting_payment' status and stock is reserved.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPrefllight } from '../_shared/cors.ts';
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

interface CheckoutRequest {
  parent_id: string;
  student_id: string;
  client_order_id: string;
  items: OrderItem[];
  payment_method: 'gcash' | 'paymaya' | 'card';
  notes?: string;
  scheduled_for?: string;
  /** @deprecated meal_period moved to individual items (Phase 3) */
  meal_period?: string;
}

const ONLINE_PAYMENT_TIMEOUT_MINUTES = 30;

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  const preflightResponse = handleCorsPrefllight(req);
  if (preflightResponse) return preflightResponse;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'CONFIG_ERROR', message: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // ── Auth ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Session expired or invalid. Please sign in again.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (user.app_metadata?.role !== 'parent') {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Only parents can place orders' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Parse request ──
    const body: CheckoutRequest = await req.json();
    const { parent_id, student_id, client_order_id, items, payment_method, notes, scheduled_for } = body;

    if (parent_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Cannot place orders on behalf of another user' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!parent_id || !student_id || !client_order_id || !items || items.length === 0) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const validOnlineMethods = ['gcash', 'paymaya', 'card'];
    if (!validOnlineMethods.includes(payment_method)) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: `Invalid online payment method: ${payment_method}. Use process-order for cash/balance.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log('Creating checkout:', { parent_id, student_id, client_order_id, items_count: items.length, payment_method });

    // ── System settings checks ──
    const { data: settingsData } = await supabaseAdmin.from('system_settings').select('key, value');
    const settings = new Map<string, unknown>();
    settingsData?.forEach(s => settings.set(s.key, s.value));

    if (settings.get('maintenance_mode') === true) {
      return new Response(
        JSON.stringify({ error: 'MAINTENANCE_MODE', message: 'The canteen is currently under maintenance.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const now = new Date();
    const phTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const currentTimeStr = phTime.toISOString().substring(11, 16);
    const todayStr = getTodayPhilippines();
    const orderDate = scheduled_for || todayStr;
    const isToday = orderDate === todayStr;

    // Operating hours (same-day only)
    const operatingHours = settings.get('operating_hours') as { open?: string; close?: string } | undefined;
    if (isToday && operatingHours?.open && operatingHours?.close) {
      if (currentTimeStr < operatingHours.open || currentTimeStr > operatingHours.close) {
        return new Response(
          JSON.stringify({ error: 'OUTSIDE_HOURS', message: `Orders can only be placed between ${operatingHours.open} and ${operatingHours.close}.` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    // Date validation
    const orderDateObj = new Date(orderDate + 'T00:00:00');
    const dayOfWeek = orderDateObj.getDay();

    if (dayOfWeek === 0) {
      return new Response(
        JSON.stringify({ error: 'INVALID_DATE', message: 'The canteen is closed on Sundays.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (dayOfWeek === 6) {
      const { data: makeupDay } = await supabaseAdmin.from('makeup_days').select('id').eq('date', orderDate).single();
      if (!makeupDay) {
        return new Response(
          JSON.stringify({ error: 'INVALID_DATE', message: 'The canteen is closed on regular Saturdays.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    // Holiday check
    const { data: holidays } = await supabaseAdmin.from('holidays').select('id, name, date, is_recurring');
    const holiday = holidays?.find(h => {
      const hd = h.date.split('T')[0];
      return h.is_recurring ? hd.slice(5) === orderDate.slice(5) : hd === orderDate;
    });
    if (holiday) {
      return new Response(
        JSON.stringify({ error: 'HOLIDAY', message: `The canteen is closed on ${holiday.name}.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Cutoff time
    const orderCutoffTime = settings.get('order_cutoff_time') as string | undefined;
    if (isToday && orderCutoffTime && currentTimeStr > orderCutoffTime) {
      return new Response(
        JSON.stringify({ error: 'PAST_CUTOFF', message: `Order cutoff time (${orderCutoffTime}) has passed.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Future order limits
    if (!isToday) {
      const allowFutureOrders = settings.get('allow_future_orders') !== false;
      const maxFutureDays = (settings.get('max_future_days') as number) || 5;
      if (!allowFutureOrders) {
        return new Response(
          JSON.stringify({ error: 'FUTURE_ORDERS_DISABLED', message: 'Future orders are currently not allowed.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const todayDateObj = new Date(todayStr + 'T00:00:00');
      const daysDiff = Math.ceil((orderDateObj.getTime() - todayDateObj.getTime()) / (86400000));
      if (daysDiff > maxFutureDays) {
        return new Response(
          JSON.stringify({ error: 'ORDER_TOO_FAR', message: `Orders can only be placed up to ${maxFutureDays} days in advance.` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      if (daysDiff < 0) {
        return new Response(
          JSON.stringify({ error: 'PAST_DATE', message: 'Cannot place orders for past dates.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    // ── Verify parent-student link ──
    const { data: studentLink, error: linkError } = await supabaseAdmin
      .from('parent_students').select('student_id')
      .eq('student_id', student_id).eq('parent_id', parent_id).single();

    if (linkError || !studentLink) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Parent is not linked to this student' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Idempotency ──
    const { data: existingOrder } = await supabaseAdmin
      .from('orders').select('id, status, total_amount, paymongo_checkout_id')
      .eq('client_order_id', client_order_id).single();

    if (existingOrder) {
      // If existing order is still awaiting payment and has a checkout URL, return it
      if (existingOrder.status === 'awaiting_payment' && existingOrder.paymongo_checkout_id) {
        try {
          const { getCheckoutSession: getSession } = await import('../_shared/paymongo.ts');
          const session = await getSession(existingOrder.paymongo_checkout_id);
          return new Response(
            JSON.stringify({
              success: true,
              order_id: existingOrder.id,
              checkout_url: session.attributes.checkout_url,
              payment_due_at: new Date(Date.now() + ONLINE_PAYMENT_TIMEOUT_MINUTES * 60 * 1000).toISOString(),
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        } catch {
          // Session expired — fall through to error
        }
      }
      return new Response(
        JSON.stringify({ error: 'DUPLICATE_ORDER', message: 'Order already exists', existing_order_id: existingOrder.id }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Duplicate slot check → auto-merge (Phase 4) ──
    const slotDate = scheduled_for || todayStr;

    const { data: slotConflicts } = await supabaseAdmin
      .from('orders')
      .select('id, status, total_amount, scheduled_for')
      .eq('student_id', student_id)
      .eq('scheduled_for', slotDate)
      .not('status', 'eq', 'cancelled');

    if (slotConflicts && slotConflicts.length > 0) {
      const existingOrder = slotConflicts[0];

      // If existing order is not in a mergeable state, return ORDER_LOCKED
      if (!['pending', 'awaiting_payment'].includes(existingOrder.status)) {
        return new Response(
          JSON.stringify({
            error: 'ORDER_LOCKED',
            message: 'An active order exists for this student and date but cannot be modified.',
            existing_order_ids: slotConflicts.map(c => c.id),
          }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // ── Merge path: validate products, reserve stock, insert items ──
      const mergeProductIds = items.map(i => i.product_id);
      const { data: mergeProducts, error: mergeProductsError } = await supabaseAdmin
        .from('products').select('id, name, price, stock_quantity, available').in('id', mergeProductIds);

      if (mergeProductsError || !mergeProducts) {
        return new Response(
          JSON.stringify({ error: 'SERVER_ERROR', message: 'Failed to fetch products' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const mergeProductMap = new Map(mergeProducts.map(p => [p.id, p]));

      for (const item of items) {
        const product = mergeProductMap.get(item.product_id);
        if (!product) {
          return new Response(
            JSON.stringify({ error: 'PRODUCT_NOT_FOUND', message: 'Product not found', product_id: item.product_id }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
        if (!product.available) {
          return new Response(
            JSON.stringify({ error: 'PRODUCT_UNAVAILABLE', message: `'${product.name}' is not available` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
        if (product.stock_quantity < item.quantity) {
          return new Response(
            JSON.stringify({ error: 'INSUFFICIENT_STOCK', message: `'${product.name}' has insufficient stock (available: ${product.stock_quantity})` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
        if (Math.abs(item.price_at_order - product.price) > 0.01) {
          return new Response(
            JSON.stringify({ error: 'PRICE_MISMATCH', message: `Price changed for '${product.name}'. Please refresh.` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
      }

      // Reserve stock for merged items
      for (const item of items) {
        const product = mergeProductMap.get(item.product_id)!;
        const { error: stockError } = await supabaseAdmin
          .from('products')
          .update({ stock_quantity: product.stock_quantity - item.quantity })
          .eq('id', item.product_id)
          .gte('stock_quantity', item.quantity);

        if (stockError) {
          return new Response(
            JSON.stringify({ error: 'STOCK_UPDATE_FAILED', message: 'Failed to reserve stock, please retry' }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
      }

      // Insert new items into existing order
      const mergeOrderItems = items.map(item => ({
        order_id: existingOrder.id,
        product_id: item.product_id,
        quantity: item.quantity,
        price_at_order: item.price_at_order,
        meal_period: item.meal_period || 'lunch',
      }));

      const { error: mergeItemsError } = await supabaseAdmin.from('order_items').insert(mergeOrderItems);
      if (mergeItemsError) {
        console.error('Merge items insert error:', mergeItemsError);
        // Restore stock on failure
        for (const item of items) {
          const product = mergeProductMap.get(item.product_id)!;
          await supabaseAdmin.from('products').update({ stock_quantity: product.stock_quantity }).eq('id', item.product_id);
        }
        return new Response(
          JSON.stringify({ error: 'MERGE_FAILED', message: 'Failed to merge items into existing order' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // Recalculate total from all items in the order
      const { data: allItems } = await supabaseAdmin
        .from('order_items')
        .select('quantity, price_at_order')
        .eq('order_id', existingOrder.id);

      const newTotal = (allItems || []).reduce((sum, i) => sum + i.quantity * i.price_at_order, 0);

      await supabaseAdmin
        .from('orders')
        .update({ total_amount: newTotal })
        .eq('id', existingOrder.id);

      console.log('Order merged:', { existing_order_id: existingOrder.id, new_items: items.length, new_total: newTotal });

      // For online payments the merged items aren't covered by a checkout session yet;
      // return success so the frontend can handle accordingly.
      return new Response(
        JSON.stringify({
          success: true,
          merged: true,
          order_id: existingOrder.id,
          merged_order_ids: [existingOrder.id],
          total_amount: newTotal,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Validate products and stock ──
    const productIds = items.map(i => i.product_id);
    const { data: products, error: productsError } = await supabaseAdmin
      .from('products').select('id, name, price, stock_quantity, available').in('id', productIds);

    if (productsError || !products) {
      return new Response(
        JSON.stringify({ error: 'SERVER_ERROR', message: 'Failed to fetch products' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const productMap = new Map(products.map(p => [p.id, p]));
    let totalAmount = 0;
    const lineItems: Array<{ name: string; quantity: number; amount: number; currency: string }> = [];

    for (const item of items) {
      const product = productMap.get(item.product_id);
      if (!product) {
        return new Response(
          JSON.stringify({ error: 'PRODUCT_NOT_FOUND', message: 'Product not found', product_id: item.product_id }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      if (!product.available) {
        return new Response(
          JSON.stringify({ error: 'PRODUCT_UNAVAILABLE', message: `'${product.name}' is not available` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      if (product.stock_quantity < item.quantity) {
        return new Response(
          JSON.stringify({ error: 'INSUFFICIENT_STOCK', message: `'${product.name}' has insufficient stock (available: ${product.stock_quantity})` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      if (Math.abs(item.price_at_order - product.price) > 0.01) {
        return new Response(
          JSON.stringify({ error: 'PRICE_MISMATCH', message: `Price changed for '${product.name}'. Please refresh.` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      totalAmount += product.price * item.quantity;
      lineItems.push({
        name: product.name,
        quantity: item.quantity,
        amount: toCentavos(product.price),
        currency: 'PHP',
      });
    }

    // PayMongo minimum is ₱20
    if (totalAmount < 20) {
      return new Response(
        JSON.stringify({ error: 'MINIMUM_AMOUNT', message: 'Minimum order amount is ₱20 for online payment.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Reserve stock ──
    for (const item of items) {
      const product = productMap.get(item.product_id)!;
      const { error: stockError } = await supabaseAdmin
        .from('products')
        .update({ stock_quantity: product.stock_quantity - item.quantity })
        .eq('id', item.product_id)
        .gte('stock_quantity', item.quantity);

      if (stockError) {
        return new Response(
          JSON.stringify({ error: 'STOCK_UPDATE_FAILED', message: 'Failed to reserve stock, please retry' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    // ── Create order in DB ──
    const paymentDueAt = new Date(Date.now() + ONLINE_PAYMENT_TIMEOUT_MINUTES * 60 * 1000).toISOString();

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        parent_id,
        student_id,
        client_order_id,
        status: 'awaiting_payment',
        payment_status: 'awaiting_payment',
        payment_due_at: paymentDueAt,
        total_amount: totalAmount,
        payment_method,
        notes: notes || null,
        scheduled_for: scheduled_for || getTodayPhilippines(),
        meal_period: null, // deprecated: meal_period moved to order_items (Phase 3)
      })
      .select()
      .single();

    if (orderError || !order) {
      console.error('Order insert error:', orderError);
      // Restore stock on failure
      for (const item of items) {
        const product = productMap.get(item.product_id)!;
        await supabaseAdmin.from('products').update({ stock_quantity: product.stock_quantity }).eq('id', item.product_id);
      }
      return new Response(
        JSON.stringify({ error: 'ORDER_CREATION_FAILED', message: 'Failed to create order' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Insert order items ──
    const orderItems = items.map(item => ({
      order_id: order.id,
      product_id: item.product_id,
      quantity: item.quantity,
      price_at_order: item.price_at_order,
      meal_period: item.meal_period || 'lunch',
    }));

    const { error: itemsError } = await supabaseAdmin.from('order_items').insert(orderItems);
    if (itemsError) {
      console.error('Order items insert error:', itemsError);
    }

    // ── Create pending payment record (payment-centric model) ──
    const { data: payment } = await supabaseAdmin
      .from('payments')
      .insert({
        parent_id,
        type: 'payment',
        amount_total: totalAmount,
        method: payment_method,
        status: 'pending',
      })
      .select('id')
      .single();

    if (payment) {
      await supabaseAdmin.from('payment_allocations').insert({
        payment_id: payment.id,
        order_id: order.id,
        allocated_amount: totalAmount,
      });
    }

    // ── Create PayMongo Checkout Session ──
    let checkoutSession;
    try {
      const { successUrl, cancelUrl } = buildCheckoutUrls('order', order.id);

      checkoutSession = await createCheckoutSession({
        lineItems,
        paymentMethodTypes: mapPaymentMethodTypes(payment_method),
        description: `School Canteen Order`,
        metadata: {
          type: 'order',
          order_id: order.id,
          parent_id,
          client_order_id,
        },
        successUrl,
        cancelUrl,
      });

      // Save PayMongo checkout ID on order
      await supabaseAdmin
        .from('orders')
        .update({ paymongo_checkout_id: checkoutSession.id })
        .eq('id', order.id);

    } catch (paymongoErr) {
      console.error('PayMongo checkout creation failed:', paymongoErr);
      // Rollback: restore stock, delete order
      for (const item of items) {
        const product = productMap.get(item.product_id)!;
        await supabaseAdmin.from('products').update({ stock_quantity: product.stock_quantity }).eq('id', item.product_id);
      }
      await supabaseAdmin.from('order_items').delete().eq('order_id', order.id);
      if (payment) {
        await supabaseAdmin.from('payment_allocations').delete().eq('payment_id', payment.id);
        await supabaseAdmin.from('payments').delete().eq('id', payment.id);
      }
      await supabaseAdmin.from('orders').delete().eq('id', order.id);

      return new Response(
        JSON.stringify({ error: 'PAYMENT_ERROR', message: 'Online payments are temporarily unavailable. Please use Cash or Wallet Balance.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log('Checkout session created:', { order_id: order.id, checkout_id: checkoutSession.id });

    return new Response(
      JSON.stringify({
        success: true,
        order_id: order.id,
        checkout_url: checkoutSession.attributes.checkout_url,
        payment_due_at: paymentDueAt,
        total_amount: totalAmount,
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
