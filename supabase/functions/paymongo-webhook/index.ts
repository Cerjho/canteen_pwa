// PayMongo Webhook Edge Function
// Receives and processes PayMongo webhook events.
// Handles: checkout_session.payment.paid, payment.failed, payment.refunded

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { verifyWebhookSignature, resolvePaymentMethod, getCheckoutSession, fromCentavos } from '../_shared/paymongo.ts';

serve(async (req) => {
  // Webhooks are always POST — no CORS needed (server-to-server)
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const rawBody = await req.text();
    const signatureHeader = req.headers.get('Paymongo-Signature') || '';

    // ── Verify webhook signature ──
    const isValid = await verifyWebhookSignature(rawBody, signatureHeader);
    if (!isValid) {
      console.error('Invalid webhook signature');
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const event = JSON.parse(rawBody);
    const eventType = event?.data?.attributes?.type;
    console.log('[webhook] Event received:', eventType, 'event_id:', event?.data?.id,
      'raw_event_keys:', JSON.stringify(Object.keys(event || {})),
      'data_keys:', JSON.stringify(Object.keys(event?.data || {})),
      'attr_keys:', JSON.stringify(Object.keys(event?.data?.attributes || {})));

    // ── Supabase Admin client ──
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    );

    switch (eventType) {
      case 'checkout_session.payment.paid':
        await handlePaymentPaid(supabaseAdmin, event);
        break;
      case 'payment.paid':
        // PayMongo might send payment.paid instead of checkout_session.payment.paid
        console.log('[webhook] Received payment.paid — routing to handlePaymentPaid');
        await handlePaymentPaid(supabaseAdmin, event);
        break;
      case 'payment.failed':
        await handlePaymentFailed(supabaseAdmin, event);
        break;
      case 'payment.refunded':
        await handlePaymentRefunded(supabaseAdmin, event);
        break;
      default:
        console.log('[webhook] Unhandled event type:', eventType,
          'full_event_data_type:', (event as any)?.data?.type,
          'data_attr_data_id:', (event as any)?.data?.attributes?.data?.id);
    }

    // Always return 200 to acknowledge receipt (prevent retries)
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Webhook processing error:', error);
    // Return 500 for transient errors so PayMongo retries
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

// ============================================
// EVENT HANDLERS
// ============================================

async function handlePaymentPaid(
  supabaseAdmin: ReturnType<typeof createClient>,
  event: Record<string, unknown>,
) {
  // ── Extract checkout data from the event ──
  // PayMongo webhook structure: event.data.attributes.data = checkout session
  let checkoutData = (event as any)?.data?.attributes?.data;

  // ── Extract checkout ID from multiple possible paths ──
  let checkoutId: string | undefined =
    checkoutData?.id ||
    checkoutData?.attributes?.id ||
    (event as any)?.data?.attributes?.data?.id;

  // Nuclear fallback: scan the entire event JSON for a checkout session ID (cs_...)
  if (!checkoutId) {
    try {
      const eventStr = JSON.stringify(event);
      const match = eventStr.match(/"(cs_[a-f0-9]{20,})"/);
      if (match) {
        checkoutId = match[1];
        console.log('[webhook] Extracted checkoutId via regex scan:', checkoutId);
      }
    } catch { /* ignore stringify errors */ }
  }

  console.log('[webhook] handlePaymentPaid —',
    'checkoutData exists:', !!checkoutData,
    'checkoutId:', checkoutId,
    'event.data.attributes keys:', JSON.stringify(Object.keys((event as any)?.data?.attributes || {})),
    'checkoutData keys:', checkoutData ? JSON.stringify(Object.keys(checkoutData)) : 'null');

  // Try multiple paths to find metadata
  let metadata = checkoutData?.attributes?.metadata;

  // Log what we found at the expected path
  console.log('[webhook] metadata from event:', JSON.stringify(metadata));

  // ── Fallback 1: PayMongo API lookup (needs checkoutId) ──
  if (!metadata?.type && checkoutId) {
    console.log('[webhook] Missing metadata.type, falling back to PayMongo API for checkout:', checkoutId);
    try {
      const freshCheckout = await getCheckoutSession(checkoutId);
      metadata = freshCheckout?.attributes?.metadata;
      console.log('[webhook] Metadata from API:', JSON.stringify(metadata),
        'payments count:', freshCheckout?.attributes?.payments?.length || 0);

      // Replace checkoutData with the full fresh API response
      if (freshCheckout) {
        checkoutData = freshCheckout;
      }
    } catch (apiErr) {
      console.error('[webhook] PayMongo API fallback failed:', apiErr);
    }
  }

  // ── Fallback 2: DB lookup by checkout ID ──
  if (!metadata?.type && checkoutId) {
    console.log('[webhook] Still no metadata, trying DB lookup for checkout:', checkoutId);

    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('id, parent_id')
      .eq('paymongo_checkout_id', checkoutId)
      .single();

    if (order) {
      metadata = { type: 'order', order_id: order.id, parent_id: order.parent_id };
      console.log('[webhook] Matched order via DB:', order.id);
    } else {
      const { data: topup } = await supabaseAdmin
        .from('topup_sessions')
        .select('id, parent_id')
        .eq('paymongo_checkout_id', checkoutId)
        .single();

      if (topup) {
        metadata = { type: 'topup', topup_session_id: topup.id, parent_id: topup.parent_id };
        console.log('[webhook] Matched topup via DB:', topup.id);
      }
    }
  }

  // ── Fallback 3: if STILL no metadata and no checkoutId, dump full event for diagnostics ──
  if (!metadata?.type) {
    console.error('[webhook] Could not resolve metadata.type.',
      'checkoutId:', checkoutId,
      'Full event (truncated):', JSON.stringify(event).substring(0, 2000));
    return;
  }

  // ── Route to appropriate handler ──
  // If checkoutData is null/undefined, use a safe empty object — handlers will use
  // paymentId=null and paymentMethod='paymongo' which is acceptable.
  const safeCheckout = checkoutData || { attributes: {} };

  if (metadata.type === 'order') {
    console.log('[webhook] Routing to handleOrderPaymentPaid, metadata:', JSON.stringify(metadata));
    await handleOrderPaymentPaid(supabaseAdmin, safeCheckout, metadata);
  } else if (metadata.type === 'topup') {
    console.log('[webhook] Routing to handleTopupPaymentPaid, metadata:', JSON.stringify(metadata));
    await handleTopupPaymentPaid(supabaseAdmin, safeCheckout, metadata);
  } else {
    console.error('[webhook] Unknown metadata type:', metadata.type);
  }
}

async function handleOrderPaymentPaid(
  supabaseAdmin: ReturnType<typeof createClient>,
  checkout: any,
  metadata: any,
) {
  const orderId = metadata.order_id;
  const paymentGroupId = metadata.payment_group_id;

  if (!orderId && !paymentGroupId) {
    console.error('Missing order_id and payment_group_id in webhook metadata');
    return;
  }

  const paymentId = checkout.attributes.payments?.[0]?.id || null;
  const paymentMethod = resolvePaymentMethod(checkout.attributes.payments || []);

  // ── Batch payment: update all orders in the payment group ──
  if (paymentGroupId) {
    console.log('Processing batch payment:', { paymentGroupId, paymentId, paymentMethod });

    const { data: groupOrders, error: groupError } = await supabaseAdmin
      .from('orders')
      .select('id, status, payment_status, parent_id, total_amount, payment_method')
      .eq('payment_group_id', paymentGroupId);

    if (groupError || !groupOrders || groupOrders.length === 0) {
      console.error('No orders found for payment_group_id:', paymentGroupId, groupError);
      // Fall through to single-order handling if orderId is present
      if (!orderId) return;
    } else {
      let confirmedCount = 0;
      for (const order of groupOrders) {
        if (order.payment_status === 'paid') {
          console.log('Order already paid (idempotent):', order.id);
          confirmedCount++;
          continue;
        }

        await confirmOrderPayment(supabaseAdmin, order, paymentId, paymentMethod, checkout.id);
        confirmedCount++;
      }
      console.log(`Batch payment confirmed: ${confirmedCount}/${groupOrders.length} orders for group ${paymentGroupId}`);
      return;
    }
  }

  // ── Single order payment (backwards compatible) ──
  console.log('Processing single order payment:', { orderId, paymentId, paymentMethod });

  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .select('id, status, payment_status, parent_id, total_amount, payment_method')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    console.error('Order not found:', orderId, orderError);
    return;
  }

  if (order.payment_status === 'paid') {
    console.log('Order already paid (idempotent):', orderId);
    return;
  }

  await confirmOrderPayment(supabaseAdmin, order, paymentId, paymentMethod, checkout.id);
  console.log('Order payment confirmed:', orderId);
}

/**
 * Confirm payment for a single order: update status + transaction.
 * Shared between single-order and batch-order flows.
 */
async function confirmOrderPayment(
  supabaseAdmin: ReturnType<typeof createClient>,
  order: { id: string; parent_id: string; total_amount: number; payment_method: string },
  paymentId: string | null,
  paymentMethod: string,
  checkoutId: string,
) {
  // Update order to paid
  const { error: updateError } = await supabaseAdmin
    .from('orders')
    .update({
      status: 'pending',
      payment_status: 'paid',
      paymongo_payment_id: paymentId,
      payment_method: paymentMethod,
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .eq('payment_status', 'awaiting_payment'); // Optimistic lock

  if (updateError) {
    console.error('Failed to update order:', order.id, updateError);
    return;
  }

  // Update or create completed transaction
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
        method: paymentMethod,
        reference_id: paymentId ? `PAYMONGO-${paymentId}` : null,
        paymongo_payment_id: paymentId,
        paymongo_checkout_id: checkoutId,
      })
      .eq('id', existingTx.id);
  } else {
    await supabaseAdmin.from('transactions').insert({
      parent_id: order.parent_id,
      order_id: order.id,
      type: 'payment',
      amount: order.total_amount,
      method: paymentMethod,
      status: 'completed',
      reference_id: paymentId ? `PAYMONGO-${paymentId}` : null,
      paymongo_payment_id: paymentId,
      paymongo_checkout_id: checkoutId,
    });
  }
}

async function handleTopupPaymentPaid(
  supabaseAdmin: ReturnType<typeof createClient>,
  checkout: any,
  metadata: any,
) {
  const topupSessionId = metadata.topup_session_id;
  if (!topupSessionId) {
    console.error('[webhook] Missing topup_session_id in webhook metadata:', JSON.stringify(metadata));
    return;
  }

  // Safe access — checkout may be a full object or an empty stub { attributes: {} }
  const paymentId = checkout?.attributes?.payments?.[0]?.id || null;
  const paymentMethod = resolvePaymentMethod(checkout?.attributes?.payments || []);

  console.log('[webhook] handleTopupPaymentPaid:', {
    topupSessionId, paymentId, paymentMethod,
    paymentsCount: checkout?.attributes?.payments?.length || 0,
    checkoutId: checkout?.id || 'unknown',
  });

  // Idempotency: check if already paid
  const { data: topupSession, error: topupError } = await supabaseAdmin
    .from('topup_sessions')
    .select('id, parent_id, amount, status, paymongo_checkout_id')
    .eq('id', topupSessionId)
    .single();

  if (topupError || !topupSession) {
    console.error('[webhook] Topup session not found:', topupSessionId, topupError?.message);
    return;
  }

  console.log('[webhook] Topup session found:', {
    id: topupSession.id, status: topupSession.status,
    amount: topupSession.amount, parent_id: topupSession.parent_id,
  });

  if (topupSession.status === 'paid') {
    console.log('[webhook] Topup already paid (idempotent):', topupSessionId);
    return;
  }

  // If no paymentId from event data, try to get it from PayMongo API
  let finalPaymentId = paymentId;
  let finalPaymentMethod = paymentMethod;
  if (!finalPaymentId && topupSession.paymongo_checkout_id) {
    try {
      const apiCheckout = await getCheckoutSession(topupSession.paymongo_checkout_id);
      const apiPayments = apiCheckout?.attributes?.payments;
      if (apiPayments?.length) {
        finalPaymentId = apiPayments[0].id;
        finalPaymentMethod = resolvePaymentMethod(apiPayments);
        console.log('[webhook] Got payment details from API:', finalPaymentId, finalPaymentMethod);
      }
    } catch (e) {
      console.warn('[webhook] Could not fetch payment details from API:', e);
    }
  }

  // Update topup session
  const { error: updateError, count: updateCount } = await supabaseAdmin
    .from('topup_sessions')
    .update({
      status: 'paid',
      payment_method: finalPaymentMethod,
      paymongo_payment_id: finalPaymentId,
      completed_at: new Date().toISOString(),
    })
    .eq('id', topupSessionId)
    .eq('status', 'pending'); // Optimistic lock

  console.log('[webhook] Topup session update result — error:', updateError?.message || 'none', 'count:', updateCount);

  if (updateError) {
    console.error('[webhook] Failed to update topup session:', updateError);
    return;
  }

  // Verify the update actually took effect
  const { data: verifyTopup } = await supabaseAdmin
    .from('topup_sessions')
    .select('status')
    .eq('id', topupSessionId)
    .single();
  console.log('[webhook] Topup status after update:', verifyTopup?.status);

  if (verifyTopup?.status !== 'paid') {
    console.error('[webhook] CRITICAL: Update returned no error but status is still:', verifyTopup?.status);
    return;
  }

  // Credit wallet balance
  const { data: wallet } = await supabaseAdmin
    .from('wallets')
    .select('balance')
    .eq('user_id', topupSession.parent_id)
    .single();

  // Supabase returns NUMERIC columns as strings — cast to Number for arithmetic
  const topupAmount = Number(topupSession.amount);
  let walletCredited = false;

  if (wallet) {
    const previousBalance = Number(wallet.balance);
    const { error: walletError } = await supabaseAdmin
      .from('wallets')
      .update({
        balance: previousBalance + topupAmount,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', topupSession.parent_id)
      .eq('balance', wallet.balance); // Optimistic lock: compare raw DB value

    if (walletError) {
      // Retry with fresh balance (up to 2 more attempts)
      for (let attempt = 1; attempt <= 2; attempt++) {
        const { data: freshWallet } = await supabaseAdmin
          .from('wallets')
          .select('balance')
          .eq('user_id', topupSession.parent_id)
          .single();

        if (freshWallet) {
          const freshBalance = Number(freshWallet.balance);
          const { error: retryError } = await supabaseAdmin
            .from('wallets')
            .update({
              balance: freshBalance + topupAmount,
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', topupSession.parent_id)
            .eq('balance', freshWallet.balance); // Compare raw DB value

          if (!retryError) {
            walletCredited = true;
            break;
          }
        }
        // Small delay between retries
        await new Promise(r => setTimeout(r, 200 * attempt));
      }

      if (!walletCredited) {
        console.error('CRITICAL: Failed to credit wallet after retries for topup:', topupSessionId, 'amount:', topupAmount, 'parent:', topupSession.parent_id);
        // Mark topup session for manual review — use 'failed' status (allowed by CHECK constraint)
        // The payment was received but wallet credit failed — needs admin intervention
        await supabaseAdmin
          .from('topup_sessions')
          .update({ status: 'failed' })
          .eq('id', topupSessionId);
        
        // Also log to transactions for audit trail
        await supabaseAdmin.from('transactions').insert({
          parent_id: topupSession.parent_id,
          type: 'topup',
          amount: topupAmount,
          method: paymentMethod,
          status: 'failed',
          reference_id: paymentId ? `PAYMONGO-${paymentId}-NEEDS-REVIEW` : `TOPUP-${topupSessionId}-NEEDS-REVIEW`,
          paymongo_payment_id: paymentId,
          paymongo_checkout_id: checkout.id,
        });
        return; // Don't create 'completed' transaction if wallet credit failed
      }
    } else {
      walletCredited = true;
    }
  } else {
    // Create wallet if it doesn't exist
    await supabaseAdmin.from('wallets').insert({
      user_id: topupSession.parent_id,
      balance: topupAmount,
    });
    walletCredited = true;
  }

  // Only create 'completed' transaction if wallet was actually credited
  if (walletCredited) {
    await supabaseAdmin.from('transactions').insert({
      parent_id: topupSession.parent_id,
      type: 'topup',
      amount: topupAmount,
      method: paymentMethod,
      status: 'completed',
      reference_id: `TOPUP-${checkout.id?.substring(0, 12)}`,
      paymongo_payment_id: paymentId,
      paymongo_checkout_id: checkout.id,
    });
  }

  console.log('Topup completed:', { topupSessionId, amount: topupSession.amount, paymentMethod });
}

async function handlePaymentFailed(
  supabaseAdmin: ReturnType<typeof createClient>,
  event: Record<string, unknown>,
) {
  const checkoutData = (event as any).data.attributes.data;
  const metadata = checkoutData?.attributes?.metadata;

  if (!metadata) return;

  if (metadata.type === 'order' && metadata.order_id) {
    console.log('Payment failed for order:', metadata.order_id);

    // Mark order as failed so parent sees it immediately instead of waiting for timeout
    const { error: updateError } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'cancelled',
        payment_status: 'failed',
        updated_at: new Date().toISOString(),
        notes: 'Payment failed via PayMongo',
      })
      .eq('id', metadata.order_id)
      .eq('payment_status', 'awaiting_payment'); // Optimistic lock

    if (!updateError) {
      // Restore stock for the failed order
      const { data: orderItems } = await supabaseAdmin
        .from('order_items')
        .select('product_id, quantity')
        .eq('order_id', metadata.order_id);

      if (orderItems) {
        for (const item of orderItems) {
          await supabaseAdmin.rpc('increment_stock', {
            p_product_id: item.product_id,
            p_quantity: item.quantity,
          }).catch(async () => {
            // Fallback: direct update if RPC doesn't exist
            const { data: product } = await supabaseAdmin
              .from('products')
              .select('stock_quantity')
              .eq('id', item.product_id)
              .single();
            if (product) {
              await supabaseAdmin
                .from('products')
                .update({ stock_quantity: product.stock_quantity + item.quantity })
                .eq('id', item.product_id);
            }
          });
        }
      }

      // Update transaction to failed
      await supabaseAdmin
        .from('transactions')
        .update({ status: 'failed' })
        .eq('order_id', metadata.order_id)
        .eq('status', 'pending');

      console.log('Order cancelled due to payment failure:', metadata.order_id);
    }
  } else if (metadata.type === 'topup' && metadata.topup_session_id) {
    console.log('Payment failed for topup:', metadata.topup_session_id);

    await supabaseAdmin
      .from('topup_sessions')
      .update({ status: 'failed' })
      .eq('id', metadata.topup_session_id)
      .eq('status', 'pending');
  }
}

async function handlePaymentRefunded(
  supabaseAdmin: ReturnType<typeof createClient>,
  event: Record<string, unknown>,
) {
  const paymentData = (event as any).data.attributes.data;
  const paymentId = paymentData?.id;

  if (!paymentId) return;

  console.log('Payment refunded:', paymentId);

  // Update any transactions referencing this payment
  await supabaseAdmin
    .from('transactions')
    .update({ status: 'completed' })
    .eq('paymongo_payment_id', paymentId)
    .eq('type', 'refund')
    .eq('status', 'pending');
}
