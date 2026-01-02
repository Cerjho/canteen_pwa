// Parent Cancel Order Edge Function
// Allows parents to cancel their own pending orders securely

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { handleCorsPrefllight, jsonResponse } from '../_shared/cors.ts';

interface CancelOrderRequest {
  order_id: string;
}

serve(async (req) => {
  const origin = req.headers.get('Origin');

  // Handle CORS preflight
  const preflightResponse = handleCorsPrefllight(req);
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
    const userRole = user.user_metadata?.role;
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

    // Fetch the order - MUST belong to this parent
    const { data: order, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select('id, status, parent_id, total_amount, payment_method, scheduled_for')
      .eq('id', order_id)
      .eq('parent_id', user.id) // Critical: only allow cancelling own orders
      .single();

    if (fetchError || !order) {
      return jsonResponse(
        { error: 'ORDER_NOT_FOUND', message: 'Order not found or does not belong to you' },
        404,
        origin
      );
    }

    // Can only cancel pending orders
    if (order.status !== 'pending') {
      return jsonResponse(
        { 
          error: 'INVALID_STATUS', 
          message: `Cannot cancel order with status '${order.status}'. Only pending orders can be cancelled.`,
          current_status: order.status
        },
        400,
        origin
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
        return jsonResponse(
          { 
            error: 'STATUS_CHANGED', 
            message: 'Order status has changed. It may already be preparing.',
            current_status: currentOrder?.status
          },
          400,
          origin
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
      return jsonResponse(
        { error: 'CANCEL_FAILED', message: 'Failed to cancel order' },
        500,
        origin
      );
    }

    // Restore stock for cancelled items
    const { data: orderItems } = await supabaseAdmin
      .from('order_items')
      .select('product_id, quantity')
      .eq('order_id', order_id);

    if (orderItems && orderItems.length > 0) {
      for (const item of orderItems) {
        // Try RPC first for atomic increment, fallback to manual update
        try {
          const { error: rpcError } = await supabaseAdmin.rpc('increment_stock', { 
            p_product_id: item.product_id, 
            p_quantity: item.quantity 
          });
          
          // If RPC doesn't exist or fails, do manual increment
          if (rpcError) {
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
        } catch (stockError) {
          // Log but don't fail the cancellation
          console.error('Stock restoration error for product', item.product_id, ':', stockError);
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

    return jsonResponse(
      {
        success: true,
        order_id,
        refund_applied: refundApplied,
        refund_amount: refundApplied ? order.total_amount : 0,
        message: refundApplied 
          ? `Order cancelled. ₱${order.total_amount.toFixed(2)} has been refunded to your wallet.`
          : 'Order cancelled successfully.'
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
