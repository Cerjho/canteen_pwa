// Parent Cancel Order Edge Function
// Allows parents to cancel their own pending orders securely

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CancelOrderRequest {
  order_id: string;
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

    // Check if user is a parent
    const userRole = user.user_metadata?.role;
    if (userRole !== 'parent') {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Parent access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: CancelOrderRequest = await req.json();
    const { order_id } = body;

    if (!order_id) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'order_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(order_id)) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Invalid order ID format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch the order - MUST belong to this parent
    const { data: order, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select('id, status, parent_id, total_amount, payment_method, scheduled_for')
      .eq('id', order_id)
      .eq('parent_id', user.id) // Critical: only allow cancelling own orders
      .single();

    if (fetchError || !order) {
      return new Response(
        JSON.stringify({ error: 'ORDER_NOT_FOUND', message: 'Order not found or does not belong to you' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Can only cancel pending orders
    if (order.status !== 'pending') {
      return new Response(
        JSON.stringify({ 
          error: 'INVALID_STATUS', 
          message: `Cannot cancel order with status '${order.status}'. Only pending orders can be cancelled.`,
          current_status: order.status
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if order is for today and already being prepared (extra validation)
    const today = new Date().toISOString().split('T')[0];
    if (order.scheduled_for === today) {
      // Double check status is still pending
      const { data: currentOrder } = await supabaseAdmin
        .from('orders')
        .select('status')
        .eq('id', order_id)
        .single();
      
      if (currentOrder?.status !== 'pending') {
        return new Response(
          JSON.stringify({ 
            error: 'STATUS_CHANGED', 
            message: 'Order status has changed. It may already be preparing.',
            current_status: currentOrder?.status
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Cancel the order
    const { error: updateError } = await supabaseAdmin
      .from('orders')
      .update({ 
        status: 'cancelled',
        updated_at: new Date().toISOString()
      })
      .eq('id', order_id)
      .eq('parent_id', user.id) // Double-check ownership
      .eq('status', 'pending'); // Only if still pending

    if (updateError) {
      console.error('Order cancel error:', updateError);
      return new Response(
        JSON.stringify({ error: 'CANCEL_FAILED', message: 'Failed to cancel order' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Restore stock for cancelled items
    const { data: orderItems } = await supabaseAdmin
      .from('order_items')
      .select('product_id, quantity')
      .eq('order_id', order_id);

    if (orderItems && orderItems.length > 0) {
      for (const item of orderItems) {
        // Increment stock for each item
        const { error: stockError } = await supabaseAdmin
          .from('products')
          .update({
            stock_quantity: supabaseAdmin.rpc('increment', { x: item.quantity }),
            updated_at: new Date().toISOString()
          })
          .eq('id', item.product_id);
        
        // If that doesn't work, do a manual increment
        if (stockError) {
          const { data: product } = await supabaseAdmin
            .from('products')
            .select('stock_quantity')
            .eq('id', item.product_id)
            .single();
          
          if (product) {
            await supabaseAdmin
              .from('products')
              .update({
                stock_quantity: (product.stock_quantity || 0) + item.quantity,
                updated_at: new Date().toISOString()
              })
              .eq('id', item.product_id);
          }
        }
      }
    }

    // If paid with balance, refund to wallet
    let refundApplied = false;
    if (order.payment_method === 'balance' && order.total_amount > 0) {
      // Get current wallet balance
      const { data: wallet } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('user_id', user.id)
        .single();

      if (wallet) {
        // Add refund to wallet
        const { error: refundError } = await supabaseAdmin
          .from('wallets')
          .update({
            balance: (wallet.balance || 0) + order.total_amount,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', user.id);

        if (!refundError) {
          refundApplied = true;

          // Record the refund transaction
          await supabaseAdmin
            .from('wallet_transactions')
            .insert({
              wallet_id: user.id,
              user_id: user.id,
              type: 'refund',
              amount: order.total_amount,
              description: `Refund for cancelled order #${order_id.slice(-6)}`,
              reference_id: order_id,
              performed_by: user.id
            });
        }
      }
    }

    console.log(`[AUDIT] Parent ${user.email} cancelled order ${order_id}. Refund: ${refundApplied ? '₱' + order.total_amount : 'N/A'}`);

    return new Response(
      JSON.stringify({
        success: true,
        order_id,
        refund_applied: refundApplied,
        refund_amount: refundApplied ? order.total_amount : 0,
        message: refundApplied 
          ? `Order cancelled. ₱${order.total_amount.toFixed(2)} has been refunded to your wallet.`
          : 'Order cancelled successfully.'
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
