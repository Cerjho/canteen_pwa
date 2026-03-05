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
  const weeklyOrderId = metadata.weekly_order_id;

  if (!orderId && !paymentGroupId && !weeklyOrderId) {
    console.error('Missing order_id, payment_group_id, and weekly_order_id in webhook metadata');
    return;
  }

  const paymentId = checkout.attributes.payments?.[0]?.id || null;
  const paymentMethod = resolvePaymentMethod(checkout.attributes.payments || []);
  // Extract paid amount in centavos from the checkout payment
  const paidAmountCentavos = checkout.attributes.payments?.[0]?.attributes?.amount ?? null;

  // ── Batch payment: update all orders in the payment group ──
  if (paymentGroupId) {
    console.log('Processing batch payment:', { paymentGroupId, paymentId, paymentMethod });

    const { data: groupOrders, error: groupError } = await supabaseAdmin
      .from('orders')
      .select('id, status, payment_status, parent_id, total_amount, payment_method')
      .eq('payment_group_id', paymentGroupId);

    // Note: weekly_order_id handling is done after batch handling below

    if (groupError || !groupOrders || groupOrders.length === 0) {
      console.error('No orders found for payment_group_id:', paymentGroupId, groupError);
      // Fall through to single-order handling if orderId is present
      if (!orderId) return;
    } else {
      // Validate total paid amount matches sum of order totals
      if (paidAmountCentavos != null) {
        const expectedCentavos = Math.round(
          groupOrders.reduce((s, o) => s + o.total_amount, 0) * 100
        );
        if (Math.abs(paidAmountCentavos - expectedCentavos) > 1) {
          console.error(`Batch amount mismatch for group ${paymentGroupId}: paid ${paidAmountCentavos} centavos, expected ${expectedCentavos} centavos`);
          return;
        }
      }

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

  // ── Weekly order payment ──
  if (weeklyOrderId) {
    console.log('Processing weekly order payment:', { weeklyOrderId, paymentId, paymentMethod });

    // Update weekly_orders payment status
    await supabaseAdmin
      .from('weekly_orders')
      .update({
        payment_status: 'paid',
        payment_method: paymentMethod,
        updated_at: new Date().toISOString(),
      })
      .eq('id', weeklyOrderId)
      .eq('payment_status', 'awaiting_payment');

    // Confirm all child daily orders
    const { data: childOrders } = await supabaseAdmin
      .from('orders')
      .select('id, status, payment_status, parent_id, total_amount, payment_method')
      .eq('weekly_order_id', weeklyOrderId)
      .eq('payment_status', 'awaiting_payment');

    if (childOrders) {
      // Validate total paid amount matches sum of child order totals
      if (paidAmountCentavos != null) {
        const expectedCentavos = Math.round(
          childOrders.reduce((s, o) => s + o.total_amount, 0) * 100
        );
        if (Math.abs(paidAmountCentavos - expectedCentavos) > 1) {
          console.error(`Weekly order amount mismatch for ${weeklyOrderId}: paid ${paidAmountCentavos} centavos, expected ${expectedCentavos} centavos`);
          return;
        }
      }

      for (const order of childOrders) {
        await confirmOrderPayment(supabaseAdmin, order, paymentId, paymentMethod, checkout.id);
      }
      console.log(`Weekly order payment confirmed: ${childOrders.length} daily orders for ${weeklyOrderId}`);
    }

    // Update weekly payment record
    const { data: woPayAlloc } = await supabaseAdmin
      .from('payments')
      .select('id')
      .eq('weekly_order_id', weeklyOrderId)
      .eq('status', 'pending')
      .limit(1)
      .single();

    if (woPayAlloc) {
      await supabaseAdmin
        .from('payments')
        .update({
          status: 'completed',
          method: paymentMethod,
          external_ref: paymentId ? `PAYMONGO-${paymentId}` : null,
          paymongo_payment_id: paymentId,
          paymongo_checkout_id: checkout.id,
        })
        .eq('id', woPayAlloc.id);
    }
    return;
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

  // Validate payment amount matches order total (amounts in centavos vs pesos)
  if (paidAmountCentavos != null) {
    const expectedCentavos = Math.round(order.total_amount * 100);
    if (Math.abs(paidAmountCentavos - expectedCentavos) > 1) {
      console.error(`Amount mismatch for order ${orderId}: paid ${paidAmountCentavos} centavos, expected ${expectedCentavos} centavos`);
      return;
    }
  }

  await confirmOrderPayment(supabaseAdmin, order, paymentId, paymentMethod, checkout.id);
  console.log('Order payment confirmed:', orderId);
}

/**
 * Confirm payment for a single order: update status + payment record.
 * Shared between single-order and batch-order flows.
 * Uses payment-centric model (payments + payment_allocations).
 */
async function confirmOrderPayment(
  supabaseAdmin: ReturnType<typeof createClient>,
  order: { id: string; parent_id: string; total_amount: number; payment_method: string },
  paymentId: string | null,
  paymentMethod: string,
  checkoutId: string,
) {
  // Update order to paid (paymongo_payment_id column removed; stored on payments table)
  const { error: updateError } = await supabaseAdmin
    .from('orders')
    .update({
      status: 'pending',
      payment_status: 'paid',
      payment_method: paymentMethod,
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .eq('payment_status', 'awaiting_payment'); // Optimistic lock

  if (updateError) {
    console.error('Failed to update order:', order.id, updateError);
    return;
  }

  // Find existing pending payment via allocation → payment join
  const { data: existingAlloc } = await supabaseAdmin
    .from('payment_allocations')
    .select('payment_id')
    .eq('order_id', order.id)
    .limit(1)
    .single();

  if (existingAlloc) {
    // Update existing payment to completed
    await supabaseAdmin
      .from('payments')
      .update({
        status: 'completed',
        method: paymentMethod,
        external_ref: paymentId ? `PAYMONGO-${paymentId}` : null,
        paymongo_payment_id: paymentId,
        paymongo_checkout_id: checkoutId,
      })
      .eq('id', existingAlloc.payment_id)
      .eq('status', 'pending');
  } else {
    // Create new completed payment + allocation (fallback if pending was missing)
    const { data: newPayment } = await supabaseAdmin
      .from('payments')
      .insert({
        parent_id: order.parent_id,
        type: 'payment',
        amount_total: order.total_amount,
        method: paymentMethod,
        status: 'completed',
        external_ref: paymentId ? `PAYMONGO-${paymentId}` : null,
        paymongo_payment_id: paymentId,
        paymongo_checkout_id: checkoutId,
      })
      .select('id')
      .single();

    if (newPayment) {
      await supabaseAdmin.from('payment_allocations').insert({
        payment_id: newPayment.id,
        order_id: order.id,
        allocated_amount: order.total_amount,
      });
    }
  }
}

async function handlePaymentFailed(
  supabaseAdmin: ReturnType<typeof createClient>,
  event: Record<string, unknown>,
) {
  const checkoutData = (event as any).data.attributes.data;
  const metadata = checkoutData?.attributes?.metadata;

  if (!metadata) return;

  if (metadata.type === 'order') {
    const paymentGroupId = metadata.payment_group_id;
    const orderId = metadata.order_id;

    // ── Batch: cancel ALL orders in the payment group ──
    if (paymentGroupId) {
      console.log('Payment failed for batch group:', paymentGroupId);

      const { data: groupOrders, error: groupError } = await supabaseAdmin
        .from('orders')
        .select('id, status, payment_status')
        .eq('payment_group_id', paymentGroupId)
        .eq('payment_status', 'awaiting_payment');

      if (groupError || !groupOrders || groupOrders.length === 0) {
        console.error('No awaiting orders found for failed payment group:', paymentGroupId, groupError);
        // Fall through to single-order handling
      } else {
        let cancelledCount = 0;
        for (const order of groupOrders) {
          await cancelFailedOrder(supabaseAdmin, order.id);
          cancelledCount++;
        }
        console.log(`Batch payment failure: cancelled ${cancelledCount}/${groupOrders.length} orders for group ${paymentGroupId}`);
        return;
      }
    }

    // ── Single order fallback ──
    if (orderId) {
      console.log('Payment failed for order:', orderId);
      await cancelFailedOrder(supabaseAdmin, orderId);
    }
  }
}

/**
 * Cancel a failed order: update status, restore stock, mark transaction failed.
 * Used by both single-order and batch failure paths.
 */
async function cancelFailedOrder(
  supabaseAdmin: ReturnType<typeof createClient>,
  orderId: string,
) {
  const { error: updateError } = await supabaseAdmin
    .from('orders')
    .update({
      status: 'cancelled',
      payment_status: 'failed',
      updated_at: new Date().toISOString(),
      notes: 'Payment failed via PayMongo',
    })
    .eq('id', orderId)
    .eq('payment_status', 'awaiting_payment'); // Optimistic lock

  if (updateError) {
    console.error('Failed to cancel order:', orderId, updateError);
    return;
  }

  // No stock restoration needed (stock tracking removed)

  // Update payment to failed via allocation lookup
  const { data: alloc } = await supabaseAdmin
    .from('payment_allocations')
    .select('payment_id')
    .eq('order_id', orderId)
    .limit(1)
    .single();

  if (alloc) {
    await supabaseAdmin
      .from('payments')
      .update({ status: 'failed' })
      .eq('id', alloc.payment_id)
      .eq('status', 'pending');
  }

  console.log('Order cancelled due to payment failure:', orderId);
}

async function handlePaymentRefunded(
  supabaseAdmin: ReturnType<typeof createClient>,
  event: Record<string, unknown>,
) {
  const paymentData = (event as any).data.attributes.data;
  const paymentId = paymentData?.id;

  if (!paymentId) return;

  console.log('Payment refunded:', paymentId);

  // Update any payments referencing this PayMongo payment
  await supabaseAdmin
    .from('payments')
    .update({ status: 'completed' })
    .eq('paymongo_payment_id', paymentId)
    .eq('type', 'refund')
    .eq('status', 'pending');
}
