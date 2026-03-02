// Parent Cancel Order Edge Function
// Allows parents to cancel their own pending orders securely

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { handleCorsPreflight, jsonResponse } from '../_shared/cors.ts';

// Helper to get today's date in Philippines timezone (UTC+8)
function getTodayPhilippines(): string {
  const now = new Date();
  // Add 8 hours for UTC+8
  const phTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  return phTime.toISOString().split('T')[0];
}

interface CancelOrderRequest {
  order_id: string;
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
    // Use Philippines timezone (UTC+8)
    const today = getTodayPhilippines();
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

    // Cancel the order with payment_status update
    const cancelData: Record<string, any> = { 
      status: 'cancelled',
      updated_at: new Date().toISOString()
    };
    if (order.total_amount > 0) {
      cancelData.payment_status = 'refunded';
    }

    const { error: updateError } = await supabaseAdmin
      .from('orders')
      .update(cancelData)
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

    // Refund to wallet for all payment methods
    let refundApplied = false;
    let refundMessage = 'Order cancelled successfully.';
    
    if (order.total_amount > 0) {
      // Look up original payment for refund lineage
      let originalPaymentId: string | null = null;
      const { data: origAlloc } = await supabaseAdmin
        .from('payment_allocations')
        .select('payment_id')
        .eq('order_id', order_id)
        .limit(1)
        .single();
      if (origAlloc) {
        const { data: origPay } = await supabaseAdmin
          .from('payments')
          .select('id, type')
          .eq('id', origAlloc.payment_id)
          .eq('type', 'payment')
          .single();
        if (origPay) originalPaymentId = origPay.id;
      }

      // Atomic: wallet credit + refund payment record + allocation in one DB transaction
      const { data: rpcId, error: rpcError } = await supabaseAdmin.rpc(
        'credit_balance_with_payment',
        {
          p_parent_id: user.id,
          p_amount: order.total_amount,
          p_type: 'refund',
          p_method: order.payment_method,
          p_reference_id: `CANCEL-${order_id.substring(0, 8)}`,
          p_order_id: order_id,
          p_original_payment_id: originalPaymentId,
        }
      );

      if (!rpcError && rpcId) {
        refundApplied = true;
        refundMessage = `Order cancelled. ₱${order.total_amount.toFixed(2)} has been added to your wallet balance.`;
      } else {
        console.error('Atomic refund error:', rpcError);
      }
    }

    console.log(`[AUDIT] Parent ${user.email} cancelled order ${order_id}. Payment: ${order.payment_method}. Refund: ${refundApplied ? '₱' + order.total_amount : 'N/A'}`);

    return jsonResponse(
      {
        success: true,
        order_id,
        payment_method: order.payment_method,
        refund_applied: refundApplied,
        refund_amount: refundApplied ? order.total_amount : 0,
        message: refundMessage
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
