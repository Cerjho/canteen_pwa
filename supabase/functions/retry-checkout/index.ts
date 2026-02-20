// Retry Checkout Edge Function
// Creates a new PayMongo Checkout Session for an existing order that is still awaiting payment.
// Used when a parent cancels or fails payment and wants to try again.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPrefllight } from '../_shared/cors.ts';
import {
  createCheckoutSession,
  toCentavos,
  mapPaymentMethodTypes,
  buildCheckoutUrls,
} from '../_shared/paymongo.ts';

const ONLINE_PAYMENT_TIMEOUT_MINUTES = 30;

interface RetryRequest {
  order_id: string;
  payment_method?: 'gcash' | 'paymaya' | 'card'; // Optional: switch payment method
}

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
        JSON.stringify({ error: 'FORBIDDEN', message: 'Only parents can retry payments' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Parse request ──
    const body: RetryRequest = await req.json();
    const { order_id, payment_method } = body;

    if (!order_id) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Order ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Fetch existing order ──
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select(`
        id, parent_id, student_id, total_amount, payment_method, payment_status,
        status, payment_due_at, scheduled_for, meal_period, notes, client_order_id,
        items:order_items(product_id, quantity, price_at_order)
      `)
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: 'NOT_FOUND', message: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Verify ownership
    if (order.parent_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'You can only retry your own orders' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Only allow retry for awaiting_payment or failed orders
    const canRetry = order.payment_status === 'awaiting_payment' || order.payment_status === 'failed';
    if (!canRetry) {
      return new Response(
        JSON.stringify({ error: 'CANNOT_RETRY', message: `Order cannot be retried (status: ${order.payment_status})` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // For failed orders, we need to re-reserve stock and reset the order
    if (order.payment_status === 'failed' || order.status === 'cancelled') {
      // Verify products are still available with sufficient stock
      const productIds = order.items.map((i: any) => i.product_id);
      const { data: products, error: productsError } = await supabaseAdmin
        .from('products')
        .select('id, name, price, stock_quantity, available')
        .in('id', productIds);

      if (productsError || !products) {
        return new Response(
          JSON.stringify({ error: 'SERVER_ERROR', message: 'Failed to verify product availability' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const productMap = new Map(products.map(p => [p.id, p]));

      for (const item of order.items) {
        const product = productMap.get(item.product_id);
        if (!product || !product.available) {
          return new Response(
            JSON.stringify({ error: 'PRODUCT_UNAVAILABLE', message: `'${product?.name || 'Product'}' is no longer available. Please place a new order.` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
        if (product.stock_quantity < item.quantity) {
          return new Response(
            JSON.stringify({ error: 'INSUFFICIENT_STOCK', message: `'${product.name}' has insufficient stock (available: ${product.stock_quantity}). Please place a new order.` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
      }

      // Re-reserve stock
      for (const item of order.items) {
        const product = productMap.get(item.product_id)!;
        const { error: stockError } = await supabaseAdmin
          .from('products')
          .update({ stock_quantity: product.stock_quantity - item.quantity })
          .eq('id', item.product_id)
          .gte('stock_quantity', item.quantity);

        if (stockError) {
          // Rollback already-reserved stock
          for (const prevItem of order.items) {
            if (prevItem.product_id === item.product_id) break;
            const prevProduct = productMap.get(prevItem.product_id)!;
            await supabaseAdmin
              .from('products')
              .update({ stock_quantity: prevProduct.stock_quantity })
              .eq('id', prevItem.product_id);
          }
          return new Response(
            JSON.stringify({ error: 'STOCK_UPDATE_FAILED', message: 'Failed to reserve stock, please retry' }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
      }
    }

    // ── Determine payment method ──
    const effectiveMethod = payment_method || order.payment_method;
    const validOnlineMethods = ['gcash', 'paymaya', 'card'];
    if (!validOnlineMethods.includes(effectiveMethod)) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Can only retry with online payment methods (gcash, paymaya, card)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Extend payment deadline ──
    const newPaymentDueAt = new Date(Date.now() + ONLINE_PAYMENT_TIMEOUT_MINUTES * 60 * 1000).toISOString();

    // Reset order to awaiting_payment
    const { error: updateError } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'awaiting_payment',
        payment_status: 'awaiting_payment',
        payment_due_at: newPaymentDueAt,
        payment_method: effectiveMethod,
        updated_at: new Date().toISOString(),
      })
      .eq('id', order_id);

    if (updateError) {
      console.error('Failed to update order for retry:', updateError);
      return new Response(
        JSON.stringify({ error: 'UPDATE_FAILED', message: 'Failed to update order' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Reset pending transaction
    await supabaseAdmin
      .from('transactions')
      .update({ status: 'pending', method: effectiveMethod })
      .eq('order_id', order_id)
      .eq('type', 'payment');

    // ── Create new PayMongo Checkout Session ──
    let checkoutSession;
    try {
      const { successUrl, cancelUrl } = buildCheckoutUrls('order', order_id);

      const lineItems = order.items.map((item: any) => ({
        name: `Order item`, // PayMongo requires a name
        quantity: item.quantity,
        amount: toCentavos(item.price_at_order),
        currency: 'PHP',
      }));

      // Get product names for line items
      const productIds = order.items.map((i: any) => i.product_id);
      const { data: products } = await supabaseAdmin
        .from('products')
        .select('id, name')
        .in('id', productIds);

      const productNames = new Map(products?.map(p => [p.id, p.name]) || []);
      const namedLineItems = order.items.map((item: any) => ({
        name: productNames.get(item.product_id) || 'Canteen Item',
        quantity: item.quantity,
        amount: toCentavos(item.price_at_order),
        currency: 'PHP',
      }));

      checkoutSession = await createCheckoutSession({
        lineItems: namedLineItems,
        paymentMethodTypes: mapPaymentMethodTypes(effectiveMethod),
        description: 'School Canteen Order (Retry)',
        metadata: {
          type: 'order',
          order_id: order_id,
          parent_id: user.id,
          client_order_id: order.client_order_id,
        },
        successUrl,
        cancelUrl,
      });

      // Save new PayMongo checkout ID on order
      await supabaseAdmin
        .from('orders')
        .update({ paymongo_checkout_id: checkoutSession.id })
        .eq('id', order_id);

    } catch (paymongoErr) {
      console.error('PayMongo retry checkout creation failed:', paymongoErr);
      // Revert order status
      await supabaseAdmin
        .from('orders')
        .update({
          status: order.status,
          payment_status: order.payment_status,
          payment_due_at: order.payment_due_at,
        })
        .eq('id', order_id);

      return new Response(
        JSON.stringify({ error: 'PAYMENT_ERROR', message: 'Online payments are temporarily unavailable. Please try again later.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log('Retry checkout session created:', { order_id, checkout_id: checkoutSession.id });

    return new Response(
      JSON.stringify({
        success: true,
        order_id: order_id,
        checkout_url: checkoutSession.attributes.checkout_url,
        payment_due_at: newPaymentDueAt,
        total_amount: order.total_amount,
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
