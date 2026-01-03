// Confirm Cash Payment Edge Function
// Staff/Admin confirms that cash payment was received from parent

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ConfirmPaymentRequest {
  order_id: string;
  amount_received?: number; // Optional: verify amount matches
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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
    const userRole = user.user_metadata?.role;
    if (!['admin', 'staff'].includes(userRole)) {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Staff or admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: ConfirmPaymentRequest = await req.json();
    const { order_id, amount_received } = body;

    if (!order_id) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'order_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch the order
    const { data: order, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select('id, status, payment_status, payment_method, payment_due_at, total_amount, parent_id')
      .eq('id', order_id)
      .single();

    if (fetchError || !order) {
      return new Response(
        JSON.stringify({ error: 'ORDER_NOT_FOUND', message: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate order state
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
        JSON.stringify({ 
          error: 'ALREADY_PAID', 
          message: 'Payment has already been confirmed for this order'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (order.payment_status === 'timeout') {
      return new Response(
        JSON.stringify({ 
          error: 'ORDER_TIMEOUT', 
          message: 'This order has been cancelled due to payment timeout'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if payment deadline has passed (even if cleanup job hasn't run yet)
    if (order.payment_due_at) {
      const paymentDeadline = new Date(order.payment_due_at);
      const now = new Date();
      if (now > paymentDeadline) {
        // Payment deadline passed - auto-update to timeout status
        await supabaseAdmin
          .from('orders')
          .update({ 
            status: 'cancelled',
            payment_status: 'timeout',
            updated_at: now.toISOString(),
            notes: 'Auto-cancelled: Payment timeout'
          })
          .eq('id', order_id)
          .eq('payment_status', 'awaiting_payment');
        
        console.log(`[CONFIRM-CASH] Order ${order_id} payment expired at ${order.payment_due_at}, rejecting confirmation`);
        
        return new Response(
          JSON.stringify({ 
            error: 'PAYMENT_EXPIRED', 
            message: 'Payment deadline has passed. This order has been cancelled.',
            payment_due_at: order.payment_due_at,
            current_time: now.toISOString()
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    if (order.status === 'cancelled') {
      return new Response(
        JSON.stringify({ 
          error: 'ORDER_CANCELLED', 
          message: 'This order has been cancelled'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Optional: Verify amount received matches order total
    if (amount_received !== undefined && amount_received < order.total_amount) {
      return new Response(
        JSON.stringify({ 
          error: 'INSUFFICIENT_AMOUNT', 
          message: `Amount received (₱${amount_received.toFixed(2)}) is less than order total (₱${order.total_amount.toFixed(2)})`,
          expected: order.total_amount,
          received: amount_received
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update order - confirm payment
    const { error: updateError } = await supabaseAdmin
      .from('orders')
      .update({ 
        payment_status: 'paid',
        status: 'pending', // Now ready for preparation
        updated_at: new Date().toISOString()
      })
      .eq('id', order_id);

    if (updateError) {
      console.error('Payment confirmation error:', updateError);
      return new Response(
        JSON.stringify({ error: 'UPDATE_FAILED', message: 'Failed to confirm payment' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update transaction record
    await supabaseAdmin
      .from('transactions')
      .update({ 
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('order_id', order_id)
      .eq('type', 'payment');

    console.log(`[AUDIT] ${userRole} ${user.email} confirmed cash payment for order ${order_id} (₱${order.total_amount})`);

    return new Response(
      JSON.stringify({
        success: true,
        order_id,
        message: 'Cash payment confirmed',
        total_amount: order.total_amount
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
