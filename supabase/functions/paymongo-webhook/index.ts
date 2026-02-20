// PayMongo Webhook Edge Function
// Receives and processes PayMongo webhook events.
// Handles: checkout_session.payment.paid, payment.failed, payment.refunded

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { verifyWebhookSignature, resolvePaymentMethod, fromCentavos } from '../_shared/paymongo.ts';

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
    console.log('Webhook event received:', eventType, 'event_id:', event?.data?.id);

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
      case 'payment.failed':
        await handlePaymentFailed(supabaseAdmin, event);
        break;
      case 'payment.refunded':
        await handlePaymentRefunded(supabaseAdmin, event);
        break;
      default:
        console.log('Unhandled webhook event type:', eventType);
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
  const checkoutData = (event as any).data.attributes.data;
  const metadata = checkoutData.attributes.metadata;

  if (!metadata?.type) {
    console.error('Missing metadata.type in webhook event');
    return;
  }

  if (metadata.type === 'order') {
    await handleOrderPaymentPaid(supabaseAdmin, checkoutData, metadata);
  } else if (metadata.type === 'topup') {
    await handleTopupPaymentPaid(supabaseAdmin, checkoutData, metadata);
  } else {
    console.error('Unknown metadata type:', metadata.type);
  }
}

async function handleOrderPaymentPaid(
  supabaseAdmin: ReturnType<typeof createClient>,
  checkout: any,
  metadata: any,
) {
  const orderId = metadata.order_id;
  if (!orderId) {
    console.error('Missing order_id in webhook metadata');
    return;
  }

  const paymentId = checkout.attributes.payments?.[0]?.id || null;
  const paymentMethod = resolvePaymentMethod(checkout.attributes.payments || []);

  console.log('Processing order payment:', { orderId, paymentId, paymentMethod });

  // Idempotency: check if already paid
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

  // Update order to paid
  const { error: updateError } = await supabaseAdmin
    .from('orders')
    .update({
      status: 'pending',
      payment_status: 'paid',
      paymongo_payment_id: paymentId,
      payment_method: paymentMethod, // Update to actual method used
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('payment_status', 'awaiting_payment'); // Optimistic lock

  if (updateError) {
    console.error('Failed to update order:', updateError);
    return;
  }

  // Update or create completed transaction
  // First try to update the existing pending transaction
  const { data: existingTx } = await supabaseAdmin
    .from('transactions')
    .select('id')
    .eq('order_id', orderId)
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
        paymongo_checkout_id: checkout.id,
      })
      .eq('id', existingTx.id);
  } else {
    // Create new transaction (shouldn't happen normally)
    await supabaseAdmin.from('transactions').insert({
      parent_id: order.parent_id,
      order_id: orderId,
      type: 'payment',
      amount: order.total_amount,
      method: paymentMethod,
      status: 'completed',
      reference_id: paymentId ? `PAYMONGO-${paymentId}` : null,
      paymongo_payment_id: paymentId,
      paymongo_checkout_id: checkout.id,
    });
  }

  console.log('Order payment confirmed:', orderId);
}

async function handleTopupPaymentPaid(
  supabaseAdmin: ReturnType<typeof createClient>,
  checkout: any,
  metadata: any,
) {
  const topupSessionId = metadata.topup_session_id;
  if (!topupSessionId) {
    console.error('Missing topup_session_id in webhook metadata');
    return;
  }

  const paymentId = checkout.attributes.payments?.[0]?.id || null;
  const paymentMethod = resolvePaymentMethod(checkout.attributes.payments || []);

  console.log('Processing topup payment:', { topupSessionId, paymentId, paymentMethod });

  // Idempotency: check if already paid
  const { data: topupSession, error: topupError } = await supabaseAdmin
    .from('topup_sessions')
    .select('id, parent_id, amount, status')
    .eq('id', topupSessionId)
    .single();

  if (topupError || !topupSession) {
    console.error('Topup session not found:', topupSessionId);
    return;
  }

  if (topupSession.status === 'paid') {
    console.log('Topup already paid (idempotent):', topupSessionId);
    return;
  }

  // Update topup session
  const { error: updateError } = await supabaseAdmin
    .from('topup_sessions')
    .update({
      status: 'paid',
      payment_method: paymentMethod,
      paymongo_payment_id: paymentId,
      completed_at: new Date().toISOString(),
    })
    .eq('id', topupSessionId)
    .eq('status', 'pending'); // Optimistic lock

  if (updateError) {
    console.error('Failed to update topup session:', updateError);
    return;
  }

  // Credit wallet balance
  const { data: wallet } = await supabaseAdmin
    .from('wallets')
    .select('balance')
    .eq('user_id', topupSession.parent_id)
    .single();

  if (wallet) {
    const previousBalance = wallet.balance;
    const { error: walletError } = await supabaseAdmin
      .from('wallets')
      .update({
        balance: previousBalance + topupSession.amount,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', topupSession.parent_id)
      .eq('balance', previousBalance); // Optimistic lock

    if (walletError) {
      // Retry with fresh balance (up to 2 more attempts)
      let retrySuccess = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const { data: freshWallet } = await supabaseAdmin
          .from('wallets')
          .select('balance')
          .eq('user_id', topupSession.parent_id)
          .single();

        if (freshWallet) {
          const { error: retryError } = await supabaseAdmin
            .from('wallets')
            .update({
              balance: freshWallet.balance + topupSession.amount,
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', topupSession.parent_id)
            .eq('balance', freshWallet.balance);

          if (!retryError) {
            retrySuccess = true;
            break;
          }
        }
        // Small delay between retries
        await new Promise(r => setTimeout(r, 200 * attempt));
      }

      if (!retrySuccess) {
        console.error('CRITICAL: Failed to credit wallet after retries for topup:', topupSessionId, 'amount:', topupSession.amount, 'parent:', topupSession.parent_id);
        // Mark topup session for manual review
        await supabaseAdmin
          .from('topup_sessions')
          .update({ status: 'requires_review' })
          .eq('id', topupSessionId);
      }
    }
  } else {
    // Create wallet if it doesn't exist
    await supabaseAdmin.from('wallets').insert({
      user_id: topupSession.parent_id,
      balance: topupSession.amount,
    });
  }

  // Create topup transaction record
  await supabaseAdmin.from('transactions').insert({
    parent_id: topupSession.parent_id,
    type: 'topup',
    amount: topupSession.amount,
    method: paymentMethod,
    status: 'completed',
    reference_id: `TOPUP-${checkout.id?.substring(0, 12)}`,
    paymongo_payment_id: paymentId,
    paymongo_checkout_id: checkout.id,
  });

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
