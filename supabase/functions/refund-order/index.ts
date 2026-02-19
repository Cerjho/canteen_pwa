// Refund Order Edge Function
// Admin-only function to refund orders and restore inventory

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPrefllight } from '../_shared/cors.ts';

interface RefundRequest {
  order_id: string;
  reason: string;
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  const preflightResponse = handleCorsPrefllight(req);
  if (preflightResponse) return preflightResponse;

  try {
    // Get auth token from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract token from Bearer header
    const token = authHeader.replace('Bearer ', '');

    // Initialize Supabase client with service role
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Get user from token using admin client
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      console.log('Auth error:', authError?.message);
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user is admin
    const userRole = user.app_metadata?.role;
    if (userRole !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: RefundRequest = await req.json();
    const { order_id, reason } = body;

    if (!order_id) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Order ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch order with items
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select(`
        *,
        items:order_items(
          product_id,
          quantity,
          price_at_order
        )
      `)
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: 'NOT_FOUND', message: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if order is already cancelled/refunded
    if (order.status === 'cancelled') {
      return new Response(
        JSON.stringify({ error: 'ALREADY_REFUNDED', message: 'Order is already cancelled/refunded' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Restore stock for each item
    for (const item of order.items) {
      try {
        // Try RPC first for atomic increment
        const { error: rpcError } = await supabaseAdmin.rpc('increment_stock', {
          p_product_id: item.product_id,
          p_quantity: item.quantity
        });
        
        // Only fall back to direct update if RPC fails
        if (rpcError) {
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
        }
      } catch (stockErr) {
        console.error(`Failed to restore stock for product ${item.product_id}:`, stockErr);
      }
    }

    // Update order status to cancelled with payment_status (with optimistic lock to prevent double-refund)
    const { data: updatedOrder, error: updateError } = await supabaseAdmin
      .from('orders')
      .update({ 
        status: 'cancelled',
        payment_status: 'refunded',
        notes: order.notes ? `${order.notes}\n\nRefund reason: ${reason}` : `Refund reason: ${reason}`
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

    // Create refund transaction
    const { data: transaction, error: txError } = await supabaseAdmin
      .from('transactions')
      .insert({
        parent_id: order.parent_id,
        order_id: order.id,
        type: 'refund',
        amount: order.total_amount,
        method: order.payment_method,
        status: 'completed',
        reference_id: `REFUND-${order_id.substring(0, 8)}`
      })
      .select()
      .single();

    if (txError) {
      console.error('Transaction insert error:', txError);
    }

    // If payment was from balance, restore parent balance with optimistic locking
    if (order.payment_method === 'balance') {
      const { data: wallet } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('user_id', order.parent_id)
        .single();

      if (wallet) {
        const previousBalance = wallet.balance;
        const { error: walletError } = await supabaseAdmin
          .from('wallets')
          .update({ 
            balance: previousBalance + order.total_amount,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', order.parent_id)
          .eq('balance', previousBalance); // Optimistic lock

        if (walletError) {
          // Retry once with fresh balance
          const { data: freshWallet } = await supabaseAdmin
            .from('wallets')
            .select('balance')
            .eq('user_id', order.parent_id)
            .single();
          
          if (freshWallet) {
            await supabaseAdmin
              .from('wallets')
              .update({ 
                balance: freshWallet.balance + order.total_amount,
                updated_at: new Date().toISOString()
              })
              .eq('user_id', order.parent_id)
              .eq('balance', freshWallet.balance);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        refunded_amount: order.total_amount,
        transaction_id: transaction?.id || null,
        message: `Order refunded successfully. Reason: ${reason}`
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
