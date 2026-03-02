// Process Batch Order Edge Function
// Handles multiple cash/balance orders in a SINGLE request.
// This eliminates the N×D sequential edge function calls from the frontend.
//
// Key optimisations vs calling process-order N times:
//   1. Auth, settings, holidays, products fetched ONCE
//   2. Stock decremented per unique product (aggregated demand)
//   3. Orders, order_items, payments + allocations inserted in batches
//   4. Balance checked & deducted ONCE (total across all orders)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';

// ── Helpers ──

function getTodayPhilippines(): string {
  const now = new Date();
  const phTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return phTime.toISOString().split('T')[0];
}

function errorResponse(
  corsHeaders: Record<string, string>,
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
) {
  return new Response(
    JSON.stringify({ error: code, message, ...extra }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

// ── Interfaces ──

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

interface BatchOrderRequest {
  parent_id: string;
  orders: OrderGroup[];
  payment_method: 'cash' | 'balance';
  notes?: string;
}

const CASH_PAYMENT_TIMEOUT_MINUTES = 240; // 4 hours

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

    // ── Parse & validate request ──
    const body: BatchOrderRequest = await req.json();
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

    const validMethods = ['cash', 'balance'];
    if (!validMethods.includes(payment_method)) {
      return errorResponse(
        corsHeaders, 400, 'INVALID_PAYMENT_METHOD',
        `Invalid payment method '${payment_method}'. For online payments, use create-batch-checkout.`,
      );
    }

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

    console.log('Processing batch order:', { parent_id, order_count: orders.length, payment_method });

    // ================================================================
    // STEP 1 — Fetch shared context ONCE (settings, holidays, products)
    // ================================================================

    const todayStr = getTodayPhilippines();
    const now = new Date();
    const phTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const currentTimeStr = phTime.toISOString().substring(11, 16); // HH:MM

    // Parallel fetch: settings, holidays, products, student links, idempotency check
    const allProductIds = [...new Set(orders.flatMap(o => o.items.map(i => i.product_id)))];
    const uniqueStudentIds = [...new Set(orders.map(o => o.student_id))];
    const allClientOrderIds = orders.map(o => o.client_order_id);

    const [settingsResult, holidaysResult, productsResult, studentLinksResult, existingOrdersResult] = await Promise.all([
      supabaseAdmin.from('system_settings').select('key, value'),
      supabaseAdmin.from('holidays').select('id, name, date, is_recurring'),
      supabaseAdmin.from('products').select('id, name, price, stock_quantity, available').in('id', allProductIds),
      supabaseAdmin.from('parent_students').select('student_id').eq('parent_id', parent_id).in('student_id', uniqueStudentIds),
      supabaseAdmin.from('orders').select('id, client_order_id, status').in('client_order_id', allClientOrderIds),
    ]);

    // ── Settings ──
    const settings = new Map<string, unknown>();
    settingsResult.data?.forEach(s => settings.set(s.key, s.value));

    if (settings.get('maintenance_mode') === true) {
      return errorResponse(corsHeaders, 503, 'MAINTENANCE_MODE', 'The canteen is currently under maintenance.');
    }

    const operatingHours = settings.get('operating_hours') as { open?: string; close?: string } | undefined;
    const orderCutoffTime = settings.get('order_cutoff_time') as string | undefined;
    const allowFutureOrders = settings.get('allow_future_orders') !== false;
    const maxFutureDays = (settings.get('max_future_days') as number) || 5;

    const holidays = holidaysResult.data || [];

    // ── Validate all unique dates ONCE ──
    const uniqueDates = [...new Set(orders.map(o => o.scheduled_for || todayStr))];

    for (const orderDate of uniqueDates) {
      const isToday = orderDate === todayStr;

      // Operating hours — same-day only
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

      const holiday = holidays.find(h => {
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

    // ── Verify parent–student links ──
    const linkedStudents = new Set(studentLinksResult.data?.map(l => l.student_id) || []);
    for (const sid of uniqueStudentIds) {
      if (!linkedStudents.has(sid)) {
        return errorResponse(corsHeaders, 401, 'UNAUTHORIZED', 'Parent is not linked to this student');
      }
    }

    // ── Idempotency check ──
    if (existingOrdersResult.data && existingOrdersResult.data.length > 0) {
      return errorResponse(corsHeaders, 409, 'DUPLICATE_ORDER', 'One or more orders already exist', {
        existing_order_ids: existingOrdersResult.data.map(o => o.id),
      });
    }

    // ── Duplicate slot check (student_id × scheduled_for) ──
    const slotChecks = orders.map(o => ({
      student_id: o.student_id,
      scheduled_for: o.scheduled_for || todayStr,
    }));

    const { data: conflicting } = await supabaseAdmin
      .from('orders')
      .select('id, student_id, scheduled_for, meal_period, status')
      .in('student_id', [...new Set(slotChecks.map(s => s.student_id))])
      .in('scheduled_for', [...new Set(slotChecks.map(s => s.scheduled_for))])
      .not('status', 'eq', 'cancelled');

    const slotConflicts = conflicting?.filter(existing =>
      slotChecks.some(s =>
        s.student_id === existing.student_id &&
        s.scheduled_for === existing.scheduled_for
      )
    );

    // Phase 4: Auto-merge — instead of failing with DUPLICATE_SLOT, merge items into existing orders
    const mergeableStatuses = ['pending', 'awaiting_payment'];
    const mergedOrderIds: string[] = [];
    const newOrders: typeof orders = [];
    let mergeDeductedTotal = 0;

    if (slotConflicts && slotConflicts.length > 0) {
      // Check if any conflicting orders are NOT mergeable (preparing/ready/completed)
      const unmergeable = slotConflicts.filter(c => !mergeableStatuses.includes(c.status));
      if (unmergeable.length > 0) {
        return errorResponse(corsHeaders, 409, 'ORDER_LOCKED',
          `Order for this student and date is already ${unmergeable[0].status}. Cannot add items.`,
          { order_id: unmergeable[0].id, status: unmergeable[0].status },
        );
      }

      // Separate orders into merge vs new
      for (const order of orders) {
        const existingOrder = slotConflicts.find(c =>
          c.student_id === order.student_id &&
          c.scheduled_for === (order.scheduled_for || todayStr)
        );

        if (existingOrder) {
          // MERGE: append items to existing order
          const mergeItems = order.items.map(item => ({
            order_id: existingOrder.id,
            product_id: item.product_id,
            quantity: item.quantity,
            price_at_order: item.price_at_order,
            meal_period: item.meal_period || 'lunch',
          }));

          const { error: mergeItemsErr } = await supabaseAdmin
            .from('order_items').insert(mergeItems);

          if (mergeItemsErr) {
            console.error('Error merging items:', mergeItemsErr);
            return errorResponse(corsHeaders, 500, 'MERGE_FAILED',
              'Failed to add items to existing order.');
          }

          // Recalculate total from all order items
          const { data: allExistingItems } = await supabaseAdmin
            .from('order_items')
            .select('price_at_order, quantity')
            .eq('order_id', existingOrder.id);

          const recalcTotal = (allExistingItems || []).reduce(
            (s: number, i: any) => s + Number(i.price_at_order) * i.quantity, 0
          );

          await supabaseAdmin.from('orders')
            .update({ total_amount: recalcTotal })
            .eq('id', existingOrder.id);

          // Deduct delta from wallet if balance payment (with proper payment/allocation records)
          if (payment_method === 'balance') {
            const delta = order.items.reduce(
              (s, i) => s + i.price_at_order * i.quantity, 0
            );
            if (delta > 0) {
              // Fetch current balance for CAS
              const { data: mergeWallet } = await supabaseAdmin
                .from('wallets').select('balance').eq('user_id', parent_id).single();

              if (!mergeWallet) {
                console.error('No wallet found for merge balance deduction');
                return errorResponse(corsHeaders, 400, 'NO_WALLET', 'No wallet found for balance deduction.');
              }

              const { error: balErr } = await supabaseAdmin.rpc('deduct_balance_with_payment', {
                p_parent_id: parent_id,
                p_expected_balance: mergeWallet.balance,
                p_amount: delta,
                p_order_ids: [existingOrder.id],
                p_order_amounts: [delta],
              });
              if (balErr) {
                console.error('Error deducting balance for merge:', balErr);
                return errorResponse(corsHeaders, 400, 'INSUFFICIENT_BALANCE', 'Failed to deduct balance for merged items.');
              }
              mergeDeductedTotal += delta;
            }
          }

          mergedOrderIds.push(existingOrder.id);
        } else {
          newOrders.push(order);
        }
      }
    } else {
      // No conflicts — all orders are new
      newOrders.push(...orders);
    }

    // ================================================================
    // STEP 2 — Validate products, prices, stock (all at once)
    // ================================================================

    if (productsResult.error || !productsResult.data) {
      return errorResponse(corsHeaders, 500, 'SERVER_ERROR', 'Failed to fetch products');
    }

    const productMap = new Map(productsResult.data.map(p => [p.id, p]));

    // Aggregate demand per product across ALL orders (including merged — they still need stock)
    const totalDemand = new Map<string, number>();
    let grandTotal = 0;
    let newOrdersGrandTotal = 0;
    const newOrderClientIds = new Set(newOrders.map(o => o.client_order_id));

    for (const order of orders) {
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

        totalDemand.set(item.product_id, (totalDemand.get(item.product_id) || 0) + item.quantity);
        grandTotal += product.price * item.quantity;
        if (newOrderClientIds.has(order.client_order_id)) {
          newOrdersGrandTotal += product.price * item.quantity;
        }
      }
    }

    // Check aggregated stock
    for (const [productId, demand] of totalDemand) {
      const product = productMap.get(productId)!;
      if (product.stock_quantity < demand) {
        return errorResponse(corsHeaders, 400, 'INSUFFICIENT_STOCK',
          `'${product.name}' has insufficient stock (available: ${product.stock_quantity}, needed: ${demand})`);
      }
    }

    // ── Balance validation (ONCE for total) ──
    let currentBalance = 0;
    if (payment_method === 'balance') {
      const { data: wallet, error: walletError } = await supabaseAdmin
        .from('wallets').select('balance').eq('user_id', parent_id).single();

      if (walletError || !wallet) {
        return errorResponse(corsHeaders, 400, 'NO_WALLET', 'No wallet found. Please top up your balance first.');
      }

      currentBalance = wallet.balance;
      if (currentBalance < newOrdersGrandTotal) {
        return errorResponse(corsHeaders, 400, 'INSUFFICIENT_BALANCE',
          `Insufficient balance. Required: ₱${newOrdersGrandTotal.toFixed(2)}, Available: ₱${currentBalance.toFixed(2)}`,
          { required: newOrdersGrandTotal, available: currentBalance });
      }
    }

    // ================================================================
    // STEP 3 — Reserve stock (one RPC per unique product, not per item)
    // ================================================================

    const reservedProducts: Array<{ product_id: string; quantity: number }> = [];
    for (const [productId, demand] of totalDemand) {
      const { error: stockError } = await supabaseAdmin.rpc('decrement_stock', {
        p_product_id: productId,
        p_quantity: demand,
      });

      if (stockError) {
        console.error('Stock reservation failed:', productId, stockError);
        for (const reserved of reservedProducts) {
          await supabaseAdmin.rpc('increment_stock', {
            p_product_id: reserved.product_id,
            p_quantity: reserved.quantity,
          }).catch(err => console.error('Rollback failed for', reserved.product_id, err));
        }
        const product = productMap.get(productId);
        return errorResponse(corsHeaders, 409, 'STOCK_UPDATE_FAILED',
          `Failed to reserve stock for '${product?.name}'. Please retry.`);
      }
      reservedProducts.push({ product_id: productId, quantity: demand });
    }

    const rollbackStock = async () => {
      for (const reserved of reservedProducts) {
        await supabaseAdmin.rpc('increment_stock', {
          p_product_id: reserved.product_id,
          p_quantity: reserved.quantity,
        }).catch(err => console.error('Stock rollback failed for', reserved.product_id, err));
      }
    };

    // ================================================================
    // STEP 4 — Create orders, order_items, payments + allocations in BATCHES
    // ================================================================

    const isCash = payment_method === 'cash';
    const paymentStatus = isCash ? 'awaiting_payment' : 'paid';
    const orderStatus = isCash ? 'awaiting_payment' : 'pending';
    const paymentDueAt = isCash
      ? new Date(Date.now() + CASH_PAYMENT_TIMEOUT_MINUTES * 60 * 1000).toISOString()
      : null;

    // Build new orders (skip merged ones)
    let createdOrders: Array<{ id: string; client_order_id: string; total_amount: number }> = [];
    let createdOrderIds: string[] = [];

    if (newOrders.length > 0) {
      const orderRows = newOrders.map(order => {
        const orderTotal = order.items.reduce((sum, item) => {
          const product = productMap.get(item.product_id)!;
          return sum + product.price * item.quantity;
        }, 0);

        return {
          parent_id,
          student_id: order.student_id,
          client_order_id: order.client_order_id,
          status: orderStatus,
          payment_status: paymentStatus,
          payment_due_at: paymentDueAt,
          total_amount: orderTotal,
          payment_method,
          notes: notes || null,
          scheduled_for: order.scheduled_for || todayStr,
          meal_period: null, // deprecated: meal_period moved to order_items (backward compat)
        };
      });

      // Batch insert all new orders at once
      const { data: insertedOrders, error: ordersError } = await supabaseAdmin
        .from('orders')
        .insert(orderRows)
        .select('id, client_order_id, total_amount');

      if (ordersError || !insertedOrders || insertedOrders.length === 0) {
        console.error('Batch order insert error:', ordersError);
        await rollbackStock();
        return errorResponse(corsHeaders, 500, 'ORDER_CREATION_FAILED', 'Failed to create orders');
      }

      createdOrders = insertedOrders;
      createdOrderIds = insertedOrders.map(o => o.id);

      // Map client_order_id → DB order id for linking items
      const orderIdMap = new Map(insertedOrders.map(o => [o.client_order_id, o.id]));

      // Build all order_items rows for batch insert
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
        // Rollback: delete all created orders (cascade deletes items) and restore stock
        await supabaseAdmin.from('orders').delete().in('id', createdOrderIds);
        await rollbackStock();
        return errorResponse(corsHeaders, 500, 'ORDER_ITEMS_FAILED', 'Failed to create order items');
      }

      // ── Payment handling ──
      if (payment_method === 'balance') {
        // Atomic RPC: deduct wallet + create payment + allocations in one DB transaction
        const orderIds = insertedOrders.map(o => o.id);
        const orderAmounts = insertedOrders.map(o => o.total_amount);

        const { data: rpcPaymentId, error: rpcError } = await supabaseAdmin.rpc(
          'deduct_balance_with_payment',
          {
            p_parent_id: parent_id,
            p_expected_balance: currentBalance,
            p_amount: newOrdersGrandTotal,
            p_order_ids: orderIds,
            p_order_amounts: orderAmounts,
          }
        );

        if (rpcError) {
          console.error('Atomic balance deduction error:', rpcError);
          // Rollback: delete orders (cascade), restore stock
          await supabaseAdmin.from('order_items').delete().in('order_id', createdOrderIds);
          await supabaseAdmin.from('orders').delete().in('id', createdOrderIds);
          await rollbackStock();
          return errorResponse(corsHeaders, 409, 'BALANCE_DEDUCTION_FAILED',
            'Failed to deduct balance. Balance may have changed. Please retry.');
        }
      } else {
        // Cash: create pending payment + allocations (no wallet deduction)
        const { data: payment, error: paymentError } = await supabaseAdmin
          .from('payments')
          .insert({
            parent_id,
            type: 'payment',
            amount_total: newOrdersGrandTotal,
            method: payment_method,
            status: 'pending',
          })
          .select('id')
          .single();

        if (paymentError || !payment) {
          console.error('Payment insert error (non-fatal):', paymentError);
          // Non-fatal — orders are already created, payment can be reconciled
        } else {
          // Link payment to each order via allocations
          const allAllocations = insertedOrders.map(o => ({
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
      }
    }

    const allOrderIds = [...mergedOrderIds, ...createdOrderIds];

    console.log('Batch order processed:', {
      order_count: createdOrderIds.length,
      merged_count: mergedOrderIds.length,
      total: grandTotal,
      payment_method,
    });

    return new Response(
      JSON.stringify({
        success: true,
        order_ids: allOrderIds,
        merged_order_ids: mergedOrderIds,
        merged: mergedOrderIds.length > 0,
        orders: createdOrders.map(o => ({
          order_id: o.id,
          client_order_id: o.client_order_id,
          total_amount: o.total_amount,
          status: orderStatus,
          payment_status: paymentStatus,
          payment_due_at: paymentDueAt,
        })),
        total_amount: grandTotal,
        message: isCash
          ? `Please pay ₱${newOrdersGrandTotal.toFixed(2)} at the cashier within ${CASH_PAYMENT_TIMEOUT_MINUTES} minutes`
          : `${allOrderIds.length} orders processed (${mergedOrderIds.length} merged, ${createdOrderIds.length} new)`,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Unexpected error:', error);
    return errorResponse(corsHeaders, 500, 'SERVER_ERROR', 'An unexpected error occurred');
  }
});
