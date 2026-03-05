// Refund Order Edge Function
// Admin-only function to refund orders. No stock restoration (stock tracking removed).
// Online payments are refunded via PayMongo; cash orders are just cancelled.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { createRefund as createPayMongoRefund, toCentavos } from '../_shared/paymongo.ts';

interface RefundRequest {
  order_id: string;
  reason: string;
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  const preflightResponse = handleCorsPreflight(req);
  if (preflightResponse) return preflightResponse;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userRole = user.app_metadata?.role;
    if (userRole !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: RefundRequest = await req.json();
    const { order_id, reason } = body;

    if (!order_id) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Order ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch order
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: 'NOT_FOUND', message: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (order.status === 'cancelled') {
      return new Response(
        JSON.stringify({ error: 'ALREADY_REFUNDED', message: 'Order is already cancelled/refunded' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Cancel order (optimistic lock to prevent double-refund)
    const { data: updatedOrder, error: updateError } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'cancelled',
        payment_status: 'refunded',
        notes: order.notes ? `${order.notes}\n\nRefund reason: ${reason}` : `Refund reason: ${reason}`,
      })
      .eq('id', order_id)
      .neq('status', 'cancelled')
      .select()
      .single();

    if (updateError || !updatedOrder) {
      return new Response(
        JSON.stringify({ error: 'ALREADY_REFUNDED', message: 'Order was already cancelled/refunded by another request' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── PayMongo refund for online payments ──
    const onlinePaymentMethods = ['gcash', 'paymaya', 'card'];
    let paymongoRefundId: string | null = null;
    let refundStatus = 'completed';
    let refundEstimate = '';

    // Look up PayMongo payment ID from the payments table
    let paymongoPaymentId: string | null = null;
    const { data: origAlloc } = await supabaseAdmin
      .from('payment_allocations')
      .select('payment_id')
      .eq('order_id', order.id)
      .limit(1)
      .single();

    let originalPaymentId: string | null = null;
    if (origAlloc) {
      const { data: origPay } = await supabaseAdmin
        .from('payments')
        .select('id, type, paymongo_payment_id')
        .eq('id', origAlloc.payment_id)
        .eq('type', 'payment')
        .single();
      if (origPay) {
        originalPaymentId = origPay.id;
        paymongoPaymentId = origPay.paymongo_payment_id;
      }
    }

    if (onlinePaymentMethods.includes(order.payment_method) && paymongoPaymentId) {
      try {
        console.log('Initiating PayMongo refund:', { payment_id: paymongoPaymentId, amount: order.total_amount });
        const refundResult = await createPayMongoRefund(
          paymongoPaymentId,
          toCentavos(order.total_amount),
          'requested_by_customer',
          `Canteen order cancellation. Reason: ${reason}`,
        );
        paymongoRefundId = refundResult.id;
        console.log('PayMongo refund created:', refundResult);

        if (order.payment_method === 'gcash') {
          refundEstimate = 'Refund will be processed to your GCash within 1 business day.';
        } else if (order.payment_method === 'paymaya') {
          refundEstimate = 'Refund will be processed to your PayMaya within 1-3 business days.';
        } else {
          refundEstimate = 'Refund will be processed to your card within 5-10 business days.';
        }
      } catch (refundErr) {
        console.error('PayMongo refund failed:', refundErr);
        refundStatus = 'pending';
        refundEstimate = 'Refund via payment provider is being processed. Please contact support if not received within 10 business days.';
      }
    } else if (onlinePaymentMethods.includes(order.payment_method) && !paymongoPaymentId) {
      console.log('No PayMongo payment ID — order was likely unpaid, no refund needed');
    }

    // ── Create refund payment record ──
    let refundPaymentId: string | null = null;

    const { data: refundPayment, error: txError } = await supabaseAdmin
      .from('payments')
      .insert({
        parent_id: order.parent_id,
        type: 'refund',
        amount_total: order.total_amount,
        method: order.payment_method,
        status: refundStatus,
        reference_id: paymongoRefundId ? `PAYMONGO-REFUND-${paymongoRefundId}` : `REFUND-${order_id.substring(0, 8)}`,
        external_ref: paymongoRefundId ? `PAYMONGO-REFUND-${paymongoRefundId}` : null,
        paymongo_refund_id: paymongoRefundId,
        original_payment_id: originalPaymentId,
      })
      .select()
      .single();

    if (refundPayment) {
      refundPaymentId = refundPayment.id;
      await supabaseAdmin.from('payment_allocations').insert({
        payment_id: refundPayment.id,
        order_id: order.id,
        allocated_amount: order.total_amount,
      });
    }

    if (txError) {
      console.error('Refund payment insert error:', txError);
    }

    // weekly_orders total_amount and status auto-recalculated by triggers

    console.log(`[AUDIT] Admin ${user.email} refunded order ${order_id}. Amount: ₱${order.total_amount}. PayMongo: ${paymongoRefundId ?? 'N/A'}`);

    return new Response(
      JSON.stringify({
        success: true,
        refunded_amount: order.total_amount,
        transaction_id: refundPaymentId,
        paymongo_refund_id: paymongoRefundId,
        refund_estimate: refundEstimate || undefined,
        message: refundEstimate
          ? `Order refunded successfully. ${refundEstimate}`
          : `Order refunded successfully. Reason: ${reason}`,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'SERVER_ERROR', message: 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
