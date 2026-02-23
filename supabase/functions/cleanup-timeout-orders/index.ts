// Cleanup Timeout Orders Edge Function
// Cancels orders (cash AND online) that haven't been paid within the timeout period
// Can be called by: scheduled job, admin trigger, or automatic on order fetch

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPrefllight } from '../_shared/cors.ts';

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  const preflightResponse = handleCorsPrefllight(req);
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
    
    // Allow cron jobs with valid secret
    const isCronJob = cronSecret && expectedCronSecret && cronSecret === expectedCronSecret;
    
    if (!isCronJob) {
      // Require user authentication for manual triggers
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

    // Find ALL expired orders (cash AND online payment methods)
    // Previously only cleaned up cash orders, causing stock leaks for abandoned online checkouts
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

    if (!expiredOrders || expiredOrders.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No expired orders found', cancelled_count: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cancelledOrders: string[] = [];
    const errors: string[] = [];

    for (const order of expiredOrders) {
      try {
        // Update order status to cancelled with timeout
        const { error: updateError } = await supabaseAdmin
          .from('orders')
          .update({ 
            status: 'cancelled',
            payment_status: 'timeout',
            updated_at: now,
            notes: 'Auto-cancelled: Payment timeout'
          })
          .eq('id', order.id)
          .eq('payment_status', 'awaiting_payment'); // Optimistic lock

        if (updateError) {
          errors.push(`Order ${order.id}: ${updateError.message}`);
          continue;
        }

        // Restore stock for cancelled order using atomic RPC
        const { data: orderItems } = await supabaseAdmin
          .from('order_items')
          .select('product_id, quantity')
          .eq('order_id', order.id);

        if (orderItems) {
          for (const item of orderItems) {
            await supabaseAdmin.rpc('increment_stock', {
              p_product_id: item.product_id,
              p_quantity: item.quantity,
            }).catch(err => console.error(`[CLEANUP] Stock restore failed for product ${item.product_id}:`, err));
          }
        }

        // Refund wallet if order was paid with balance
        // (Balance is deducted immediately at order creation, must be returned on timeout)
        if (order.payment_method === 'balance' && order.total_amount > 0) {
          const refundAmount = Number(order.total_amount);
          const { data: wallet } = await supabaseAdmin
            .from('wallets')
            .select('balance')
            .eq('user_id', order.parent_id)
            .single();

          if (wallet) {
            const currentBalance = Number(wallet.balance);
            const { error: refundError } = await supabaseAdmin
              .from('wallets')
              .update({ balance: currentBalance + refundAmount, updated_at: now })
              .eq('user_id', order.parent_id)
              .eq('balance', wallet.balance); // Optimistic lock

            if (!refundError) {
              // Record refund transaction
              await supabaseAdmin.from('transactions').insert({
                parent_id: order.parent_id,
                order_id: order.id,
                type: 'refund',
                amount: refundAmount,
                method: 'balance',
                status: 'completed',
                reference_id: `TIMEOUT-${order.id.substring(0, 8)}`,
              });
              console.log(`[CLEANUP] Refunded ₱${refundAmount} to wallet for balance-paid order ${order.id}`);
            } else {
              console.error(`[CLEANUP] CRITICAL: Failed to refund wallet for order ${order.id}:`, refundError);
              errors.push(`Order ${order.id}: Wallet refund failed`);
            }
          }
        }

        // Update transaction status to 'failed' (valid per CHECK constraint)
        await supabaseAdmin
          .from('transactions')
          .update({ status: 'failed' })
          .eq('order_id', order.id)
          .eq('type', 'payment');

        cancelledOrders.push(order.id);
        console.log(`[CLEANUP] Cancelled order ${order.id} (${order.payment_method || 'unknown'}) due to payment timeout`);

      } catch (err) {
        errors.push(`Order ${order.id}: ${err}`);
      }
    }

    // ── Also clean up expired topup sessions ──
    let expiredTopups = 0;
    try {
      const { data: expiredSessions } = await supabaseAdmin
        .from('topup_sessions')
        .select('id')
        .eq('status', 'pending')
        .lt('expires_at', now);

      if (expiredSessions && expiredSessions.length > 0) {
        for (const session of expiredSessions) {
          await supabaseAdmin
            .from('topup_sessions')
            .update({ status: 'expired' })
            .eq('id', session.id)
            .eq('status', 'pending');
        }
        expiredTopups = expiredSessions.length;
        console.log(`[CLEANUP] Expired ${expiredTopups} topup sessions`);
      }
    } catch (err) {
      console.error('Failed to clean up topup sessions:', err);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Cancelled ${cancelledOrders.length} expired orders, expired ${expiredTopups} topup sessions`,
        cancelled_count: cancelledOrders.length,
        cancelled_orders: cancelledOrders,
        expired_topups: expiredTopups,
        errors: errors.length > 0 ? errors : undefined
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
