// Check Payment Status Edge Function
// DB lookup for frontend to poll payment status after PayMongo redirect.
// If DB still shows awaiting_payment for an online order, falls back to
// querying PayMongo directly and self-heals the DB if payment was completed.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPrefllight } from '../_shared/cors.ts';
import { getCheckoutSession, resolvePaymentMethod } from '../_shared/paymongo.ts';

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
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Session expired or invalid.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Parse request ──
    // Accept both GET query params and POST body
    let orderId: string | null = null;
    let topupSessionId: string | null = null;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      orderId = url.searchParams.get('order_id');
      topupSessionId = url.searchParams.get('topup_session_id');
    } else {
      const body = await req.json();
      orderId = body.order_id || null;
      topupSessionId = body.topup_session_id || null;
    }

    // ── Check order payment status ──
    if (orderId) {
      const { data: order, error: orderError } = await supabaseAdmin
        .from('orders')
        .select('id, status, payment_status, payment_method, total_amount, parent_id, paymongo_checkout_id')
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

            const { error: updateError } = await supabaseAdmin
              .from('orders')
              .update({
                status: 'pending',
                payment_status: 'paid',
                paymongo_payment_id: paymentId,
                payment_method: resolvedMethod,
                updated_at: new Date().toISOString(),
              })
              .eq('id', order.id)
              .eq('payment_status', 'awaiting_payment'); // Optimistic lock

            if (updateError) {
              console.error('Fallback: Failed to update order:', order.id, updateError);
            } else {
              console.log('Fallback: Self-healed order', order.id, 'payment confirmed via PayMongo API');

              // Also update/create the transaction record
              const { data: existingTx } = await supabaseAdmin
                .from('transactions')
                .select('id')
                .eq('order_id', order.id)
                .eq('type', 'payment')
                .eq('status', 'pending')
                .single();

              if (existingTx) {
                await supabaseAdmin
                  .from('transactions')
                  .update({
                    status: 'completed',
                    method: resolvedMethod,
                    reference_id: paymentId ? `PAYMONGO-${paymentId}` : null,
                    paymongo_payment_id: paymentId,
                    paymongo_checkout_id: order.paymongo_checkout_id,
                  })
                  .eq('id', existingTx.id);
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

    // ── Check topup session status ──
    if (topupSessionId) {
      const { data: topup, error: topupError } = await supabaseAdmin
        .from('topup_sessions')
        .select('id, status, amount, payment_method, parent_id, completed_at, paymongo_checkout_id')
        .eq('id', topupSessionId)
        .single();

      if (topupError || !topup) {
        return new Response(
          JSON.stringify({ error: 'NOT_FOUND', message: 'Top-up session not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      if (topup.parent_id !== user.id) {
        return new Response(
          JSON.stringify({ error: 'FORBIDDEN', message: 'Access denied' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // ── Fallback: If still pending and has a PayMongo checkout, check PayMongo directly ──
      if (topup.status === 'pending' && topup.paymongo_checkout_id) {
        console.log('[check-status] Topup is pending, checking PayMongo API for:', topup.paymongo_checkout_id);
        try {
          const checkout = await getCheckoutSession(topup.paymongo_checkout_id);
          const payments = checkout?.attributes?.payments;
          const firstPayment = payments?.[0];

          console.log('[check-status] PayMongo checkout response:',
            'status:', checkout?.attributes?.status,
            'payments count:', payments?.length || 0,
            'first payment status:', firstPayment?.attributes?.status,
            'first payment id:', firstPayment?.id);

          if (firstPayment && firstPayment.attributes?.status === 'paid') {
            // Payment was completed but webhook didn't update the DB — self-heal
            const paymentId = firstPayment.id;
            const resolvedMethod = resolvePaymentMethod(payments);

            // Update topup session to paid
            const { error: updateError } = await supabaseAdmin
              .from('topup_sessions')
              .update({
                status: 'paid',
                payment_method: resolvedMethod,
                paymongo_payment_id: paymentId,
                completed_at: new Date().toISOString(),
              })
              .eq('id', topup.id)
              .eq('status', 'pending'); // Optimistic lock

            if (!updateError) {
              console.log('Fallback: Self-healed topup', topup.id, 'payment confirmed via PayMongo API');

              // Credit wallet balance — cast NUMERIC strings to Number for arithmetic
              const topupAmount = Number(topup.amount);
              const { data: wallet } = await supabaseAdmin
                .from('wallets')
                .select('balance')
                .eq('user_id', topup.parent_id)
                .single();

              let walletCredited = false;
              if (wallet) {
                const currentBalance = Number(wallet.balance);
                const { error: walletError } = await supabaseAdmin
                  .from('wallets')
                  .update({
                    balance: currentBalance + topupAmount,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('user_id', topup.parent_id)
                  .eq('balance', wallet.balance); // Compare raw DB value for optimistic lock

                if (walletError) {
                  console.error('Fallback: Failed to credit wallet for topup:', topup.id, walletError);
                  // Revert topup session to pending so webhook can retry
                  await supabaseAdmin
                    .from('topup_sessions')
                    .update({ status: 'pending' })
                    .eq('id', topup.id);
                } else {
                  walletCredited = true;
                }
              } else {
                // Create wallet if it doesn't exist
                await supabaseAdmin.from('wallets').insert({
                  user_id: topup.parent_id,
                  balance: topupAmount,
                });
                walletCredited = true;
              }

              if (walletCredited) {
                // Create transaction record only if wallet was credited
                await supabaseAdmin.from('transactions').insert({
                  parent_id: topup.parent_id,
                  type: 'topup',
                  amount: topupAmount,
                  method: resolvedMethod,
                  status: 'completed',
                  reference_id: paymentId ? `PAYMONGO-${paymentId}` : null,
                  paymongo_payment_id: paymentId,
                  paymongo_checkout_id: topup.paymongo_checkout_id,
                });

                return new Response(
                  JSON.stringify({
                    topup_session_id: topup.id,
                    status: 'paid',
                    amount: topupAmount,
                    payment_method: resolvedMethod,
                    completed_at: new Date().toISOString(),
                  }),
                  { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                );
              }
              // If wallet credit failed, fall through to return current DB status
            } else {
              console.error('Fallback: Failed to update topup session:', topup.id, updateError);
            }
          }
        } catch (paymongoError) {
          // PayMongo API check failed — return DB status as-is
          console.error('Fallback: PayMongo API check failed for topup', topup.id, paymongoError);
        }
      }

      return new Response(
        JSON.stringify({
          topup_session_id: topup.id,
          status: topup.status,
          amount: topup.amount,
          payment_method: topup.payment_method,
          completed_at: topup.completed_at,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Provide order_id or topup_session_id' }),
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
