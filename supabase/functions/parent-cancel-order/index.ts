// Parent Cancel Order Edge Function
// Allows parents to cancel a specific day from a weekly order.
// Uses validate_daily_cancellation() RPC to enforce 8 AM cutoff.
// No stock restoration or wallet refund (those systems are removed).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { handleCorsPreflight, jsonResponse } from '../_shared/cors.ts';

interface CancelOrderRequest {
  order_id: string; // The daily order to cancel
}

serve(async (req) => {
  const origin = req.headers.get('Origin');

  // Handle CORS preflight
  const preflightResponse = handleCorsPreflight(req);
  if (preflightResponse) return preflightResponse;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse(
        { error: 'UNAUTHORIZED', message: 'Missing authorization header' },
        401,
        origin
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
      return jsonResponse(
        { error: 'UNAUTHORIZED', message: 'Invalid token' },
        401,
        origin
      );
    }

    // Check if user is a parent
    const userRole = user.app_metadata?.role;
    if (userRole !== 'parent') {
      return jsonResponse(
        { error: 'FORBIDDEN', message: 'Parent access required' },
        403,
        origin
      );
    }

    const body: CancelOrderRequest = await req.json();
    const { order_id } = body;

    if (!order_id) {
      return jsonResponse(
        { error: 'VALIDATION_ERROR', message: 'order_id is required' },
        400,
        origin
      );
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(order_id)) {
      return jsonResponse(
        { error: 'VALIDATION_ERROR', message: 'Invalid order ID format' },
        400,
        origin
      );
    }

    // Validate cancellation via DB function (enforces 8 AM cutoff)
    const { data: validation, error: validationError } = await supabaseAdmin.rpc(
      'validate_daily_cancellation',
      { p_order_id: order_id, p_parent_id: user.id }
    );

    if (validationError) {
      console.error('Cancellation validation error:', validationError);
      // Parse Postgres error message for user-friendly response
      const msg = validationError.message || 'Cannot cancel this order';
      return jsonResponse(
        { error: 'CANCELLATION_DENIED', message: msg },
        400,
        origin
      );
    }

    // Cancel the order
    const { error: updateError } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'cancelled',
        payment_status: 'refunded',
        updated_at: new Date().toISOString(),
      })
      .eq('id', order_id)
      .eq('parent_id', user.id)
      .in('status', ['pending', 'confirmed']);

    if (updateError) {
      console.error('Order cancel error:', updateError);
      return jsonResponse(
        { error: 'CANCEL_FAILED', message: 'Failed to cancel order' },
        500,
        origin
      );
    }

    // weekly_orders total_amount is auto-recalculated by the
    // trg_recalculate_weekly_order_total trigger when status → cancelled.
    // weekly_orders status is auto-transitioned by trg_transition_weekly_order_status.

    const cancelledAmount = validation?.total_amount ?? 0;

    console.log(`[AUDIT] Parent ${user.email} cancelled daily order ${order_id} for ${validation?.scheduled_for}. Amount: ₱${cancelledAmount}`);

    return jsonResponse(
      {
        success: true,
        order_id,
        scheduled_for: validation?.scheduled_for,
        cancelled_amount: cancelledAmount,
        message: `Day cancelled successfully. ₱${Number(cancelledAmount).toFixed(2)} will be refunded.`,
      },
      200,
      origin
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return jsonResponse(
      { error: 'SERVER_ERROR', message: 'An unexpected error occurred' },
      500,
      origin
    );
  }
});
