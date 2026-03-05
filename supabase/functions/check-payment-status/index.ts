// Check Payment Status Edge Function
// DB lookup for frontend to poll payment status after PayMongo redirect.
// If DB still shows awaiting_payment for an online order, falls back to
// querying PayMongo directly and self-heals the DB if payment was completed.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { getCheckoutSession, resolvePaymentMethod } from '../_shared/paymongo.ts';

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  const preflightResponse = handleCorsPreflight(req);
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
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Session expired or invalid.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Parse request ──
    // Accept both GET query params and POST body
    let orderId: string | null = null;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      orderId = url.searchParams.get('order_id');
    } else {
      const body = await req.json();
      orderId = body.order_id || null;
    }

    // ── Check order payment status ──
    if (orderId) {
      const { data: order, error: orderError } = await supabaseAdmin
        .from('orders')
        .select('id, status, payment_status, payment_method, total_amount, parent_id, paymongo_checkout_id, payment_group_id')
        .eq('id', orderId)
        .single();

      if (orderError || !order) {
        return new Response(
          JSON.stringify({ error: 'NOT_FOUND', message: 'Order not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // Only allow parents to check their own orders
      if (order.parent_id !== user.id && user.app_metadata?.role !== 'admin') {
        return new Response(
          JSON.stringify({ error: 'FORBIDDEN', message: 'Access denied' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // ── Fallback: If still awaiting_payment and has a PayMongo checkout, check PayMongo directly ──
      if (
        order.payment_status === 'awaiting_payment' &&
        order.paymongo_checkout_id &&
        ['gcash', 'paymaya', 'card', 'paymongo'].includes(order.payment_method)
      ) {
        try {
          const checkout = await getCheckoutSession(order.paymongo_checkout_id);
          const payments = checkout.attributes?.payments;
          const firstPayment = payments?.[0];

          if (firstPayment && firstPayment.attributes?.status === 'paid') {
            // Payment was completed but webhook didn't update the DB — self-heal
            const paymentId = firstPayment.id;
            const resolvedMethod = resolvePaymentMethod(payments);

            // Helper to self-heal a single order
            const selfHealOrder = async (healOrderId: string) => {
              const { error: updateError } = await supabaseAdmin
                .from('orders')
                .update({
                  status: 'pending',
                  payment_status: 'paid',
                  payment_method: resolvedMethod,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', healOrderId)
                .eq('payment_status', 'awaiting_payment'); // Optimistic lock

              if (updateError) {
                console.error('Fallback: Failed to update order:', healOrderId, updateError);
                return;
              }

              // Update payment record via allocation lookup
              const { data: existingAlloc } = await supabaseAdmin
                .from('payment_allocations')
                .select('payment_id')
                .eq('order_id', healOrderId)
                .limit(1)
                .single();

              if (existingAlloc) {
                await supabaseAdmin
                  .from('payments')
                  .update({
                    status: 'completed',
                    method: resolvedMethod,
                    external_ref: paymentId ? `PAYMONGO-${paymentId}` : null,
                    paymongo_payment_id: paymentId,
                    paymongo_checkout_id: order.paymongo_checkout_id,
                  })
                  .eq('id', existingAlloc.payment_id);
              }

              console.log('Fallback: Self-healed order', healOrderId, 'payment confirmed via PayMongo API');
            };

            // Self-heal this order
            await selfHealOrder(order.id);

            // Also self-heal batch siblings if this is a batch payment
            if (order.payment_group_id) {
              const { data: siblings } = await supabaseAdmin
                .from('orders')
                .select('id')
                .eq('payment_group_id', order.payment_group_id)
                .eq('payment_status', 'awaiting_payment')
                .neq('id', order.id);

              if (siblings && siblings.length > 0) {
                console.log('Fallback: Self-healing', siblings.length, 'batch siblings for group', order.payment_group_id);
                for (const sibling of siblings) {
                  await selfHealOrder(sibling.id);
                }
              }
            }

            return new Response(
              JSON.stringify({
                order_id: order.id,
                payment_status: 'paid',
                order_status: 'pending',
                payment_method: resolvedMethod,
                total_amount: order.total_amount,
              }),
              { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
          }
        } catch (paymongoError) {
          // PayMongo API check failed — return DB status as-is, don't block the poll
          console.error('Fallback: PayMongo API check failed for order', order.id, paymongoError);
        }
      }

      return new Response(
        JSON.stringify({
          order_id: order.id,
          payment_status: order.payment_status,
          order_status: order.status,
          payment_method: order.payment_method,
          total_amount: order.total_amount,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ error: 'VALIDATION_ERROR', message: 'order_id is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'SERVER_ERROR', message: 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
