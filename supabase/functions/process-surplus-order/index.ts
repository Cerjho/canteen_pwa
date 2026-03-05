// Process Surplus Order Edge Function
// Creates a single order for surplus items available TODAY.
// Surplus items are leftovers marked by staff for same-day sale.
// Orders must be placed before the surplus cutoff time (default: 8 AM Manila).
//
// Supports cash and online (gcash/paymaya/card) payments.
// For online payments, a PayMongo checkout session is created.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import {
  createCheckoutSession,
  toCentavos,
  mapPaymentMethodTypes,
} from '../_shared/paymongo.ts';

function getPhilippineTime(): Date {
  const now = new Date();
  return new Date(now.getTime() + 8 * 60 * 60 * 1000);
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

interface SurplusItem {
  product_id: string;
  quantity: number;
  price_at_order: number;
  meal_period?: string;
}

interface SurplusOrderRequest {
  parent_id: string;
  student_id: string;
  items: SurplusItem[];
  payment_method: 'cash' | 'gcash' | 'paymaya' | 'card';
  notes?: string;
}

const CASH_PAYMENT_TIMEOUT_MINUTES = 4 * 60;
const ONLINE_PAYMENT_TIMEOUT_MINUTES = 30;

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
      return errorResponse(corsHeaders, 403, 'FORBIDDEN', 'Only parents can place surplus orders');
    }

    // ── Parse request ──
    const body: SurplusOrderRequest = await req.json();
    const { parent_id, student_id, items, payment_method, notes } = body;

    if (parent_id !== user.id) {
      return errorResponse(corsHeaders, 403, 'FORBIDDEN', 'Cannot place orders on behalf of another user');
    }

    if (!parent_id || !student_id || !items || items.length === 0) {
      return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', 'Missing required fields');
    }

    const validMethods = ['cash', 'gcash', 'paymaya', 'card'];
    if (!validMethods.includes(payment_method)) {
      return errorResponse(corsHeaders, 400, 'INVALID_PAYMENT_METHOD', 'Invalid payment method');
    }

    for (const item of items) {
      if (!item.product_id || item.quantity <= 0 || item.price_at_order < 0) {
        return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', 'Invalid item data');
      }
    }

    // ── System settings ──
    const { data: settingsData } = await supabaseAdmin.from('system_settings').select('key, value');
    const settings = new Map<string, unknown>();
    settingsData?.forEach(s => settings.set(s.key, s.value));

    if (settings.get('maintenance_mode') === true) {
      return errorResponse(corsHeaders, 503, 'MAINTENANCE_MODE', 'The canteen is currently under maintenance.');
    }

    // ── Validate surplus cutoff ──
    const surplusCutoffTime = (settings.get('surplus_cutoff_time') as string) || '08:00';
    const phNow = getPhilippineTime();
    const currentTimeStr = phNow.toISOString().substring(11, 16);
    const todayStr = phNow.toISOString().split('T')[0];

    if (currentTimeStr > surplusCutoffTime) {
      return errorResponse(corsHeaders, 400, 'PAST_CUTOFF',
        `Surplus order cutoff time (${surplusCutoffTime}) has passed.`);
    }

    // ── Verify parent-student link ──
    const { data: studentLink } = await supabaseAdmin
      .from('parent_students')
      .select('student_id')
      .eq('student_id', student_id)
      .eq('parent_id', parent_id)
      .single();

    if (!studentLink) {
      return errorResponse(corsHeaders, 401, 'UNAUTHORIZED', 'Parent is not linked to this student');
    }

    // ── Validate surplus items exist and have availability ──
    const surplusProductIds = items.map(i => i.product_id);
    const { data: surplusItems, error: surplusError } = await supabaseAdmin
      .from('surplus_items')
      .select('id, product_id, quantity_available, original_price, scheduled_date, meal_period')
      .eq('scheduled_date', todayStr)
      .in('product_id', surplusProductIds);

    if (surplusError || !surplusItems) {
      return errorResponse(corsHeaders, 500, 'SERVER_ERROR', 'Failed to fetch surplus items');
    }

    const surplusMap = new Map(surplusItems.map(s => [s.product_id, s]));

    // Validate products
    const { data: products } = await supabaseAdmin
      .from('products')
      .select('id, name, price, available')
      .in('id', surplusProductIds);

    if (!products) {
      return errorResponse(corsHeaders, 500, 'SERVER_ERROR', 'Failed to fetch products');
    }

    const productMap = new Map(products.map(p => [p.id, p]));
    let totalAmount = 0;
    const lineItems: Array<{ name: string; quantity: number; amount: number; currency: string }> = [];

    for (const item of items) {
      const product = productMap.get(item.product_id);
      if (!product) {
        return errorResponse(corsHeaders, 400, 'PRODUCT_NOT_FOUND', 'Product not found', { product_id: item.product_id });
      }

      const surplus = surplusMap.get(item.product_id);
      if (!surplus) {
        return errorResponse(corsHeaders, 400, 'NOT_SURPLUS',
          `'${product.name}' is not available as a surplus item today`);
      }

      if (surplus.quantity_available < item.quantity) {
        return errorResponse(corsHeaders, 400, 'INSUFFICIENT_SURPLUS',
          `'${product.name}' surplus has only ${surplus.quantity_available} remaining`,
          { available: surplus.quantity_available, requested: item.quantity });
      }

      // Use surplus price (original_price from when it was marked) or current price
      const price = surplus.original_price || product.price;
      if (Math.abs(item.price_at_order - price) > 0.01) {
        return errorResponse(corsHeaders, 400, 'PRICE_MISMATCH', `Price changed for '${product.name}'. Please refresh.`);
      }

      totalAmount += price * item.quantity;
      lineItems.push({
        name: `${product.name} (surplus)`,
        quantity: item.quantity,
        amount: toCentavos(price),
        currency: 'PHP',
      });
    }

    // ── Decrement surplus availability ──
    for (const item of items) {
      const surplus = surplusMap.get(item.product_id)!;
      const { error: updateErr } = await supabaseAdmin
        .from('surplus_items')
        .update({ quantity_available: surplus.quantity_available - item.quantity })
        .eq('id', surplus.id)
        .gte('quantity_available', item.quantity);

      if (updateErr) {
        return errorResponse(corsHeaders, 409, 'SURPLUS_UPDATE_FAILED', 'Failed to reserve surplus. Please retry.');
      }
    }

    // ── Create order ──
    const isCash = payment_method === 'cash';
    const timeoutMinutes = isCash ? CASH_PAYMENT_TIMEOUT_MINUTES : ONLINE_PAYMENT_TIMEOUT_MINUTES;
    const paymentDueAt = new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString();

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        parent_id,
        student_id,
        order_type: 'surplus',
        status: 'awaiting_payment',
        payment_status: 'awaiting_payment',
        payment_due_at: paymentDueAt,
        total_amount: totalAmount,
        payment_method,
        notes: notes || null,
        scheduled_for: todayStr,
        client_order_id: `SURPLUS-${crypto.randomUUID().substring(0, 8)}-${todayStr}`,
      })
      .select('id')
      .single();

    if (orderError || !order) {
      console.error('Surplus order insert error:', orderError);
      // Rollback surplus availability
      for (const item of items) {
        const surplus = surplusMap.get(item.product_id)!;
        await supabaseAdmin
          .from('surplus_items')
          .update({ quantity_available: surplus.quantity_available })
          .eq('id', surplus.id);
      }
      return errorResponse(corsHeaders, 500, 'ORDER_CREATION_FAILED', 'Failed to create surplus order');
    }

    // ── Insert order items ──
    const orderItems = items.map(item => {
      const surplus = surplusMap.get(item.product_id)!;
      return {
        order_id: order.id,
        product_id: item.product_id,
        quantity: item.quantity,
        price_at_order: item.price_at_order,
        meal_period: surplus.meal_period || item.meal_period || 'lunch',
      };
    });

    await supabaseAdmin.from('order_items').insert(orderItems);

    // ── Create payment record ──
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

    // ── For online payment, create PayMongo checkout ──
    if (!isCash) {
      if (totalAmount < 20) {
        return errorResponse(corsHeaders, 400, 'MINIMUM_AMOUNT', 'Minimum order amount is ₱20 for online payment.');
      }

      try {
        const appUrl = Deno.env.get('APP_URL') || 'http://localhost:5173';
        const successUrl = `${appUrl}/order-confirmation?payment=success&order_id=${order.id}`;
        const cancelUrl = `${appUrl}/order-confirmation?payment=cancelled&order_id=${order.id}`;

        const checkoutSession = await createCheckoutSession({
          lineItems,
          paymentMethodTypes: mapPaymentMethodTypes(payment_method),
          description: 'LOHECA Canteen — Surplus Order',
          metadata: {
            type: 'order',
            order_id: order.id,
            parent_id,
          },
          successUrl,
          cancelUrl,
        });

        await supabaseAdmin
          .from('orders')
          .update({ paymongo_checkout_id: checkoutSession.id })
          .eq('id', order.id);

        console.log('Surplus checkout created:', { order_id: order.id, checkout_id: checkoutSession.id });

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
      } catch (paymongoErr) {
        console.error('PayMongo checkout creation failed:', paymongoErr);
        // Rollback
        await supabaseAdmin.from('order_items').delete().eq('order_id', order.id);
        if (payment) {
          await supabaseAdmin.from('payment_allocations').delete().eq('payment_id', payment.id);
          await supabaseAdmin.from('payments').delete().eq('id', payment.id);
        }
        await supabaseAdmin.from('orders').delete().eq('id', order.id);
        for (const item of items) {
          const surplus = surplusMap.get(item.product_id)!;
          await supabaseAdmin.from('surplus_items').update({ quantity_available: surplus.quantity_available }).eq('id', surplus.id);
        }
        return errorResponse(corsHeaders, 502, 'PAYMENT_ERROR', 'Online payments are temporarily unavailable. Please use cash.');
      }
    }

    // Cash path response
    console.log('Surplus order created (cash):', { order_id: order.id, total: totalAmount });

    return new Response(
      JSON.stringify({
        success: true,
        order_id: order.id,
        total_amount: totalAmount,
        payment_due_at: paymentDueAt,
        message: `Surplus order created. Please pay ₱${totalAmount.toFixed(2)} at the cashier.`,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Unexpected error:', error);
    return errorResponse(corsHeaders, 500, 'SERVER_ERROR', 'An unexpected error occurred');
  }
});
