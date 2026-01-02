// Cleanup Timeout Orders Edge Function
// Cancels cash orders that haven't been paid within the timeout period
// Can be called by: scheduled job, admin trigger, or automatic on order fetch

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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
      
      const userRole = user.user_metadata?.role;
      if (!['admin', 'staff'].includes(userRole)) {
        return new Response(
          JSON.stringify({ error: 'FORBIDDEN', message: 'Admin or staff access required' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const now = new Date().toISOString();

    // Find all expired cash orders
    const { data: expiredOrders, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select('id, parent_id, total_amount, payment_due_at')
      .eq('payment_status', 'awaiting_payment')
      .eq('payment_method', 'cash')
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

        // Restore stock for cancelled order
        const { data: orderItems } = await supabaseAdmin
          .from('order_items')
          .select('product_id, quantity')
          .eq('order_id', order.id);

        if (orderItems) {
          for (const item of orderItems) {
            await supabaseAdmin.rpc('increment_stock', {
              p_product_id: item.product_id,
              p_quantity: item.quantity
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

        // Update transaction status
        await supabaseAdmin
          .from('transactions')
          .update({ status: 'cancelled', updated_at: now })
          .eq('order_id', order.id);

        cancelledOrders.push(order.id);
        console.log(`[CLEANUP] Cancelled order ${order.id} due to payment timeout`);

      } catch (err) {
        errors.push(`Order ${order.id}: ${err}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Cancelled ${cancelledOrders.length} expired orders`,
        cancelled_count: cancelledOrders.length,
        cancelled_orders: cancelledOrders,
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
