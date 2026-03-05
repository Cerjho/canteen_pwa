// Cleanup Timeout Orders Edge Function
// Cancels orders and weekly_orders that haven't been paid within the timeout period.
// No stock restoration or wallet refund (those systems are removed).
// Can be called by: scheduled job, admin trigger, or automatic on order fetch.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  const preflightResponse = handleCorsPreflight(req);
  if (preflightResponse) return preflightResponse;

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Verify authentication - either API key for cron jobs or user token
    const authHeader = req.headers.get('Authorization');
    const cronSecret = req.headers.get('X-Cron-Secret');
    const expectedCronSecret = Deno.env.get('CRON_SECRET');
    
    const isCronJob = cronSecret && expectedCronSecret && cronSecret === expectedCronSecret;
    
    if (!isCronJob) {
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: 'UNAUTHORIZED', message: 'Authentication required' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
      
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: 'UNAUTHORIZED', message: 'Invalid token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const userRole = user.app_metadata?.role;
      if (!['admin', 'staff'].includes(userRole)) {
        return new Response(
          JSON.stringify({ error: 'FORBIDDEN', message: 'Admin or staff access required' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const now = new Date().toISOString();

    // ── 1. Cancel expired daily orders ──
    const { data: expiredOrders, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select('id, parent_id, total_amount, payment_due_at, payment_method, payment_status')
      .eq('payment_status', 'awaiting_payment')
      .lt('payment_due_at', now);

    if (fetchError) {
      console.error('Error fetching expired orders:', fetchError);
      return new Response(
        JSON.stringify({ error: 'FETCH_FAILED', message: 'Failed to fetch expired orders' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cancelledOrders: string[] = [];
    const errors: string[] = [];

    if (expiredOrders && expiredOrders.length > 0) {
      for (const order of expiredOrders) {
        try {
          const { error: updateError } = await supabaseAdmin
            .from('orders')
            .update({
              status: 'cancelled',
              payment_status: 'timeout',
              updated_at: now,
              notes: 'Auto-cancelled: Payment timeout',
            })
            .eq('id', order.id)
            .eq('payment_status', 'awaiting_payment');

          if (updateError) {
            errors.push(`Order ${order.id}: ${updateError.message}`);
            continue;
          }

          // Update payment to failed via allocation lookup
          const { data: orderAlloc } = await supabaseAdmin
            .from('payment_allocations')
            .select('payment_id')
            .eq('order_id', order.id)
            .limit(1)
            .single();

          if (orderAlloc) {
            await supabaseAdmin
              .from('payments')
              .update({ status: 'failed' })
              .eq('id', orderAlloc.payment_id)
              .eq('status', 'pending');
          }

          cancelledOrders.push(order.id);
          console.log(`[CLEANUP] Cancelled order ${order.id} (${order.payment_method || 'unknown'}) due to payment timeout`);
        } catch (err) {
          errors.push(`Order ${order.id}: ${err}`);
        }
      }
    }

    // ── 2. Cancel expired weekly_orders ──
    let cancelledWeeklyOrders = 0;
    try {
      const { data: expiredWeekly } = await supabaseAdmin
        .from('weekly_orders')
        .select('id')
        .eq('payment_status', 'awaiting_payment')
        .lt('payment_due_at', now);

      if (expiredWeekly && expiredWeekly.length > 0) {
        for (const wo of expiredWeekly) {
          // Cancel the weekly order
          await supabaseAdmin
            .from('weekly_orders')
            .update({
              status: 'cancelled',
              payment_status: 'timeout',
              updated_at: now,
            })
            .eq('id', wo.id)
            .eq('payment_status', 'awaiting_payment');

          // Cancel all child daily orders
          await supabaseAdmin
            .from('orders')
            .update({
              status: 'cancelled',
              payment_status: 'timeout',
              updated_at: now,
              notes: 'Auto-cancelled: Weekly order payment timeout',
            })
            .eq('weekly_order_id', wo.id)
            .eq('payment_status', 'awaiting_payment');

          cancelledWeeklyOrders++;
        }
        console.log(`[CLEANUP] Cancelled ${cancelledWeeklyOrders} expired weekly orders`);
      }
    } catch (err) {
      console.error('Failed to clean up weekly orders:', err);
      errors.push(`Weekly orders cleanup: ${err}`);
    }

    // weekly_orders status auto-transitions via trigger when all daily orders reach terminal state

    return new Response(
      JSON.stringify({
        success: true,
        message: `Cancelled ${cancelledOrders.length} expired orders, ${cancelledWeeklyOrders} expired weekly orders`,
        cancelled_count: cancelledOrders.length,
        cancelled_orders: cancelledOrders,
        cancelled_weekly_orders: cancelledWeeklyOrders,
        errors: errors.length > 0 ? errors : undefined,
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
