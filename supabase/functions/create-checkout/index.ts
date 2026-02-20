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
}

interface CheckoutRequest {
  parent_id: string;
  student_id: string;
  client_order_id: string;
  items: OrderItem[];
  payment_method: 'gcash' | 'paymaya' | 'card';
  notes?: string;
  scheduled_for?: string;
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
    const { parent_id, student_id, client_order_id, items, payment_method, notes, scheduled_for, meal_period } = body;

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
        meal_period: meal_period || 'lunch',
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
    }));

    const { error: itemsError } = await supabaseAdmin.from('order_items').insert(orderItems);
    if (itemsError) {
      console.error('Order items insert error:', itemsError);
    }

    // ── Create pending transaction ──
    await supabaseAdmin.from('transactions').insert({
      parent_id,
      order_id: order.id,
      type: 'payment',
      amount: totalAmount,
      method: payment_method,
      status: 'pending',
    });

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
      await supabaseAdmin.from('transactions').delete().eq('order_id', order.id);
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
