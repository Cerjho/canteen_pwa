// Confirm Cash Payment Edge Function
// Staff/Admin confirms that cash payment was received from parent.
// Supports both single order confirmation (surplus/walk-in) and
// weekly order confirmation (confirms all child daily orders at once).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';

interface ConfirmPaymentRequest {
  order_id?: string;           // For single order (surplus/walk-in)
  weekly_order_id?: string;    // For weekly order (confirms all child orders)
  amount_received?: number;    // Optional: verify amount matches
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

    // Verify user
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user is admin or staff
    const userRole = user.app_metadata?.role;
    if (!['admin', 'staff'].includes(userRole)) {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Staff or admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: ConfirmPaymentRequest = await req.json();
    const { order_id, weekly_order_id, amount_received } = body;

    if (!order_id && !weekly_order_id) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'order_id or weekly_order_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Weekly order confirmation ──
    if (weekly_order_id) {
      const { data: weeklyOrder, error: woFetchErr } = await supabaseAdmin
        .from('weekly_orders')
        .select('id, status, payment_status, payment_method, total_amount, payment_due_at')
        .eq('id', weekly_order_id)
        .single();

      if (woFetchErr || !weeklyOrder) {
        return new Response(
          JSON.stringify({ error: 'NOT_FOUND', message: 'Weekly order not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (weeklyOrder.payment_method !== 'cash') {
        return new Response(
          JSON.stringify({ error: 'INVALID_PAYMENT_METHOD', message: 'Weekly order was not set to cash payment' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (weeklyOrder.payment_status === 'paid') {
        return new Response(
          JSON.stringify({ error: 'ALREADY_PAID', message: 'Weekly order payment already confirmed' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (weeklyOrder.status === 'cancelled' || weeklyOrder.payment_status === 'timeout') {
        return new Response(
          JSON.stringify({ error: 'ORDER_CANCELLED', message: 'Weekly order has been cancelled or timed out' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check payment deadline
      if (weeklyOrder.payment_due_at) {
        const deadline = new Date(weeklyOrder.payment_due_at);
        const now = new Date();
        if (now > deadline) {
          await supabaseAdmin
            .from('weekly_orders')
            .update({ status: 'cancelled', payment_status: 'timeout', updated_at: now.toISOString() })
            .eq('id', weekly_order_id)
            .eq('payment_status', 'awaiting_payment');

          return new Response(
            JSON.stringify({ error: 'PAYMENT_EXPIRED', message: 'Payment deadline has passed. Weekly order cancelled.' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      // Verify amount if provided
      if (amount_received !== undefined && amount_received < weeklyOrder.total_amount) {
        return new Response(
          JSON.stringify({
            error: 'INSUFFICIENT_AMOUNT',
            message: `Amount received (₱${amount_received.toFixed(2)}) is less than weekly total (₱${weeklyOrder.total_amount.toFixed(2)})`,
            expected: weeklyOrder.total_amount,
            received: amount_received,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const now = new Date().toISOString();

      // Update weekly order payment status
      const { error: woUpdateErr } = await supabaseAdmin
        .from('weekly_orders')
        .update({ payment_status: 'paid', updated_at: now })
        .eq('id', weekly_order_id)
        .eq('payment_status', 'awaiting_payment');

      if (woUpdateErr) {
        return new Response(
          JSON.stringify({ error: 'ALREADY_PAID', message: 'Payment was already confirmed by another request' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Confirm all child daily orders that are awaiting payment
      const { data: childOrders } = await supabaseAdmin
        .from('orders')
        .select('id')
        .eq('weekly_order_id', weekly_order_id)
        .eq('payment_status', 'awaiting_payment');

      const confirmedOrderIds: string[] = [];
      if (childOrders) {
        for (const child of childOrders) {
          await supabaseAdmin
            .from('orders')
            .update({ payment_status: 'paid', status: 'pending', updated_at: now })
            .eq('id', child.id)
            .eq('payment_status', 'awaiting_payment');

          // Update associated payment record
          const { data: alloc } = await supabaseAdmin
            .from('payment_allocations')
            .select('payment_id')
            .eq('order_id', child.id)
            .limit(1)
            .single();

          if (alloc) {
            await supabaseAdmin
              .from('payments')
              .update({ status: 'completed' })
              .eq('id', alloc.payment_id)
              .eq('status', 'pending');
          }

          confirmedOrderIds.push(child.id);
        }
      }

      // Also update payment record linked to weekly_order_id
      const { data: woAlloc } = await supabaseAdmin
        .from('payment_allocations')
        .select('payment_id')
        .eq('order_id', weekly_order_id)
        .limit(1)
        .single();

      if (woAlloc) {
        await supabaseAdmin
          .from('payments')
          .update({ status: 'completed' })
          .eq('id', woAlloc.payment_id)
          .eq('status', 'pending');
      }

      console.log(`[AUDIT] ${userRole} ${user.email} confirmed cash payment for weekly order ${weekly_order_id} (₱${weeklyOrder.total_amount}), ${confirmedOrderIds.length} daily orders confirmed`);

      return new Response(
        JSON.stringify({
          success: true,
          weekly_order_id,
          message: 'Weekly cash payment confirmed',
          total_amount: weeklyOrder.total_amount,
          confirmed_orders: confirmedOrderIds.length,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Single order confirmation (surplus / walk-in) ──
    const { data: order, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select('id, status, payment_status, payment_method, payment_due_at, total_amount, parent_id')
      .eq('id', order_id!)
      .single();

    if (fetchError || !order) {
      return new Response(
        JSON.stringify({ error: 'ORDER_NOT_FOUND', message: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (order.payment_method !== 'cash') {
      return new Response(
        JSON.stringify({ 
          error: 'INVALID_PAYMENT_METHOD', 
          message: 'This order was not paid with cash',
          payment_method: order.payment_method
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (order.payment_status === 'paid') {
      return new Response(
        JSON.stringify({ error: 'ALREADY_PAID', message: 'Payment has already been confirmed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (order.payment_status === 'timeout') {
      return new Response(
        JSON.stringify({ error: 'ORDER_TIMEOUT', message: 'Order cancelled due to payment timeout' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check payment deadline
    if (order.payment_due_at) {
      const paymentDeadline = new Date(order.payment_due_at);
      const now = new Date();
      if (now > paymentDeadline) {
        await supabaseAdmin
          .from('orders')
          .update({ status: 'cancelled', payment_status: 'timeout', updated_at: now.toISOString(), notes: 'Auto-cancelled: Payment timeout' })
          .eq('id', order_id!)
          .eq('payment_status', 'awaiting_payment');

        return new Response(
          JSON.stringify({ error: 'PAYMENT_EXPIRED', message: 'Payment deadline has passed. Order cancelled.', payment_due_at: order.payment_due_at }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    if (order.status === 'cancelled') {
      return new Response(
        JSON.stringify({ error: 'ORDER_CANCELLED', message: 'This order has been cancelled' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify amount
    if (amount_received !== undefined && amount_received < order.total_amount) {
      return new Response(
        JSON.stringify({
          error: 'INSUFFICIENT_AMOUNT',
          message: `Amount received (₱${amount_received.toFixed(2)}) is less than order total (₱${order.total_amount.toFixed(2)})`,
          expected: order.total_amount,
          received: amount_received,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Confirm payment (optimistic lock)
    const { data: updatedOrder, error: updateError } = await supabaseAdmin
      .from('orders')
      .update({ payment_status: 'paid', status: 'pending', updated_at: new Date().toISOString() })
      .eq('id', order_id!)
      .eq('payment_status', 'awaiting_payment')
      .select()
      .single();

    if (updateError || !updatedOrder) {
      return new Response(
        JSON.stringify({ error: 'ALREADY_PAID', message: 'Payment was already confirmed by another request' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update payment record
    const { data: alloc } = await supabaseAdmin
      .from('payment_allocations')
      .select('payment_id')
      .eq('order_id', order_id!)
      .limit(1)
      .single();

    if (alloc) {
      await supabaseAdmin
        .from('payments')
        .update({ status: 'completed' })
        .eq('id', alloc.payment_id)
        .eq('status', 'pending');
    }

    console.log(`[AUDIT] ${userRole} ${user.email} confirmed cash payment for order ${order_id} (₱${order.total_amount})`);

    return new Response(
      JSON.stringify({
        success: true,
        order_id,
        message: 'Cash payment confirmed',
        total_amount: order.total_amount,
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
