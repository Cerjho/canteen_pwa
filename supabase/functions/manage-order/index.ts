// Manage Order Edge Function
// Secure server-side order management for admin and staff

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPrefllight } from '../_shared/cors.ts';

type OrderStatus = 'awaiting_payment' | 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled';
type Action = 'update-status' | 'cancel' | 'add-notes' | 'bulk-update-status' | 'mark-item-unavailable';

interface ManageOrderRequest {
  action: Action;
  order_id?: string;
  order_ids?: string[]; // For bulk operations
  item_id?: string; // For mark-item-unavailable
  status?: OrderStatus;
  notes?: string;
  reason?: string; // For cancellation
}

// Valid status transitions
// Note: awaiting_payment -> pending is handled by confirm-cash-payment, not here
const validTransitions: Record<OrderStatus, OrderStatus[]> = {
  awaiting_payment: ['cancelled'], // Can only cancel awaiting_payment orders (payment confirmation is separate)
  pending: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [], // Final state
  cancelled: [], // Final state
};

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  // Handle CORS preflight
  const preflightResponse = handleCorsPrefllight(req);
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
        JSON.stringify({ error: 'FORBIDDEN', message: 'Admin or staff access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: ManageOrderRequest = await req.json();
    const { action, order_id, order_ids, item_id, status, notes, reason } = body;

    // Validate action
    const validActions: Action[] = ['update-status', 'cancel', 'add-notes', 'bulk-update-status', 'mark-item-unavailable'];
    if (!validActions.includes(action)) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: `Invalid action. Must be: ${validActions.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    switch (action) {
      case 'update-status': {
        if (!order_id || !status) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'order_id and status are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Validate status value
        const validStatuses: OrderStatus[] = ['awaiting_payment', 'pending', 'preparing', 'ready', 'completed', 'cancelled'];
        if (!validStatuses.includes(status)) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: `Invalid status. Must be: ${validStatuses.join(', ')}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Fetch current order
        const { data: order, error: orderError } = await supabaseAdmin
          .from('orders')
          .select('id, status, payment_status, payment_due_at, payment_method, parent_id, total_amount')
          .eq('id', order_id)
          .single();

        if (orderError || !order) {
          return new Response(
            JSON.stringify({ error: 'ORDER_NOT_FOUND', message: 'Order not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Check if order payment has expired (for awaiting_payment orders)
        if (order.status === 'awaiting_payment' && order.payment_due_at) {
          const now = new Date();
          const paymentDeadline = new Date(order.payment_due_at);
          if (now > paymentDeadline && status !== 'cancelled') {
            // Auto-update to timeout status
            await supabaseAdmin
              .from('orders')
              .update({ 
                status: 'cancelled',
                payment_status: 'timeout',
                updated_at: now.toISOString(),
                notes: 'Auto-cancelled: Payment timeout'
              })
              .eq('id', order_id);
            
            return new Response(
              JSON.stringify({ 
                error: 'PAYMENT_EXPIRED', 
                message: 'Payment deadline has passed. Order has been cancelled.',
                payment_due_at: order.payment_due_at
              }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }
        
        // Block status changes on timeout orders
        if (order.payment_status === 'timeout') {
          return new Response(
            JSON.stringify({ 
              error: 'ORDER_TIMEOUT', 
              message: 'This order has been cancelled due to payment timeout. No status changes allowed.'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Validate status transition
        const currentStatus = order.status as OrderStatus;
        const allowedTransitions = validTransitions[currentStatus];
        
        if (!allowedTransitions.includes(status)) {
          return new Response(
            JSON.stringify({ 
              error: 'INVALID_TRANSITION', 
              message: `Cannot transition from '${currentStatus}' to '${status}'. Allowed: ${allowedTransitions.join(', ') || 'none'}`,
              current_status: currentStatus,
              allowed_transitions: allowedTransitions
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Prepare update data
        const updateData: Record<string, any> = {
          status,
          updated_at: new Date().toISOString()
        };

        if (status === 'completed') {
          updateData.completed_at = new Date().toISOString();
        }

        // Update order
        const { error: updateError } = await supabaseAdmin
          .from('orders')
          .update(updateData)
          .eq('id', order_id);

        if (updateError) {
          console.error('Order update error:', updateError);
          return new Response(
            JSON.stringify({ error: 'UPDATE_FAILED', message: 'Failed to update order' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] ${userRole} ${user.email} changed order ${order_id} from '${currentStatus}' to '${status}'`);

        return new Response(
          JSON.stringify({
            success: true,
            order_id,
            previous_status: currentStatus,
            new_status: status
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'bulk-update-status': {
        if (!order_ids || order_ids.length === 0 || !status) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'order_ids array and status are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Validate status value
        const validStatuses: OrderStatus[] = ['pending', 'preparing', 'ready', 'completed'];
        if (!validStatuses.includes(status)) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: `Invalid status for bulk update. Must be: ${validStatuses.join(', ')}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Determine which previous statuses are valid for this transition
        const validPreviousStatuses: OrderStatus[] = [];
        for (const [prevStatus, allowed] of Object.entries(validTransitions)) {
          if (allowed.includes(status)) {
            validPreviousStatuses.push(prevStatus as OrderStatus);
          }
        }

        // Prepare update data
        const updateData: Record<string, any> = {
          status,
          updated_at: new Date().toISOString()
        };

        if (status === 'completed') {
          updateData.completed_at = new Date().toISOString();
        }

        // Update orders that can transition to this status
        const { data: updatedOrders, error: updateError } = await supabaseAdmin
          .from('orders')
          .update(updateData)
          .in('id', order_ids)
          .in('status', validPreviousStatuses)
          .select('id');

        if (updateError) {
          console.error('Bulk order update error:', updateError);
          return new Response(
            JSON.stringify({ error: 'UPDATE_FAILED', message: 'Failed to update orders' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const updatedCount = updatedOrders?.length || 0;
        console.log(`[AUDIT] ${userRole} ${user.email} bulk updated ${updatedCount} orders to '${status}'`);

        return new Response(
          JSON.stringify({
            success: true,
            updated_count: updatedCount,
            new_status: status
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'cancel': {
        if (!order_id) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'order_id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Fetch current order
        const { data: order, error: orderError } = await supabaseAdmin
          .from('orders')
          .select('id, status, payment_status, parent_id, total_amount, payment_method')
          .eq('id', order_id)
          .single();

        if (orderError || !order) {
          return new Response(
            JSON.stringify({ error: 'ORDER_NOT_FOUND', message: 'Order not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const currentStatus = order.status as OrderStatus;
        
        // Can only cancel non-final orders
        if (currentStatus === 'completed' || currentStatus === 'cancelled') {
          return new Response(
            JSON.stringify({ 
              error: 'INVALID_TRANSITION', 
              message: `Cannot cancel an order with status '${currentStatus}'`
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        // Order already timed out
        if (order.payment_status === 'timeout') {
          return new Response(
            JSON.stringify({ 
              error: 'ALREADY_TIMEOUT', 
              message: 'Order was already cancelled due to payment timeout'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Update order to cancelled with payment_status
        const updateData: Record<string, any> = { 
          status: 'cancelled',
          notes: reason ? `Cancelled: ${reason}` : 'Cancelled by staff/admin',
          updated_at: new Date().toISOString()
        };
        // Set payment_status to refunded only if the order was already paid
        // For awaiting_payment orders, we don't set refunded since no money was collected
        if (order.total_amount > 0 && order.payment_status === 'paid') {
          updateData.payment_status = 'refunded';
        }

        const { error: updateError } = await supabaseAdmin
          .from('orders')
          .update(updateData)
          .eq('id', order_id);

        if (updateError) {
          return new Response(
            JSON.stringify({ error: 'UPDATE_FAILED', message: 'Failed to cancel order' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Restore stock using atomic RPC
        const { data: orderItems } = await supabaseAdmin
          .from('order_items')
          .select('product_id, quantity')
          .eq('order_id', order_id);

        if (orderItems) {
          for (const item of orderItems) {
            await supabaseAdmin.rpc('increment_stock', { 
              p_product_id: item.product_id, 
              p_quantity: item.quantity 
            }).catch(err => console.error(`Stock restore failed for product ${item.product_id}:`, err));
          }
        }

        // Refund to wallet only if order was actually paid
        // (awaiting_payment cash orders haven't collected money yet)
        let refundApplied = false;
        if (order.total_amount > 0 && order.payment_status === 'paid') {
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
              p_parent_id: order.parent_id,
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
          } else if (rpcError) {
            console.error('Atomic refund error:', rpcError);
          }
        }

        console.log(`[AUDIT] ${userRole} ${user.email} cancelled order ${order_id}. Reason: ${reason || 'Not provided'}. Refund: ${refundApplied ? '₱' + order.total_amount : 'N/A'}`);

        return new Response(
          JSON.stringify({
            success: true,
            order_id,
            previous_status: currentStatus,
            new_status: 'cancelled',
            refund_applied: refundApplied,
            refund_amount: refundApplied ? order.total_amount : 0
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'mark-item-unavailable': {
        if (!order_id || !item_id) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'order_id and item_id are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Fetch the order
        const { data: mOrder, error: mOrderError } = await supabaseAdmin
          .from('orders')
          .select('id, status, payment_status, parent_id, total_amount, payment_method')
          .eq('id', order_id)
          .single();

        if (mOrderError || !mOrder) {
          return new Response(
            JSON.stringify({ error: 'ORDER_NOT_FOUND', message: 'Order not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Only allow marking items on pending or preparing orders
        if (!['pending', 'preparing'].includes(mOrder.status)) {
          return new Response(
            JSON.stringify({ error: 'INVALID_STATUS', message: `Cannot mark items unavailable on an order with status '${mOrder.status}'` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Fetch the item and verify it belongs to this order
        const { data: mItem, error: mItemError } = await supabaseAdmin
          .from('order_items')
          .select('id, order_id, product_id, quantity, price_at_order, status')
          .eq('id', item_id)
          .eq('order_id', order_id)
          .single();

        if (mItemError || !mItem) {
          return new Response(
            JSON.stringify({ error: 'ITEM_NOT_FOUND', message: 'Order item not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (mItem.status === 'unavailable') {
          return new Response(
            JSON.stringify({ error: 'ALREADY_UNAVAILABLE', message: 'This item is already marked as unavailable' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // 1. Set item status to unavailable
        const { error: itemUpdateError } = await supabaseAdmin
          .from('order_items')
          .update({ status: 'unavailable' })
          .eq('id', item_id);

        if (itemUpdateError) {
          return new Response(
            JSON.stringify({ error: 'UPDATE_FAILED', message: 'Failed to mark item unavailable' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // 2. Restore stock for the unavailable item
        await supabaseAdmin.rpc('increment_stock', {
          p_product_id: mItem.product_id,
          p_quantity: mItem.quantity,
        }).catch(err => console.error(`Stock restore failed for product ${mItem.product_id}:`, err));

        // 3. Recalculate order total from remaining confirmed items
        const { data: confirmedItems } = await supabaseAdmin
          .from('order_items')
          .select('price_at_order, quantity, status')
          .eq('order_id', order_id);

        const newTotal = (confirmedItems || []) 
          .filter(i => i.status === 'confirmed')
          .reduce((sum, i) => sum + i.price_at_order * i.quantity, 0);

        const allUnavailable = (confirmedItems || []).every(i => i.status === 'unavailable');

        // 4. Update the order total (and cancel if all items unavailable)
        const orderUpdate: Record<string, unknown> = {
          total_amount: newTotal,
          updated_at: new Date().toISOString(),
        };

        if (allUnavailable) {
          orderUpdate.status = 'cancelled';
          orderUpdate.notes = 'Auto-cancelled: All items marked unavailable';
        }

        await supabaseAdmin.from('orders').update(orderUpdate).eq('id', order_id);

        // 5. Partial refund if order was paid with balance
        const refundAmount = mItem.price_at_order * mItem.quantity;
        let refundApplied = false;

        if (refundAmount > 0 && mOrder.payment_status === 'paid') {
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

          const { error: rpcError } = await supabaseAdmin.rpc(
            'credit_balance_with_payment',
            {
              p_parent_id: mOrder.parent_id,
              p_amount: refundAmount,
              p_type: 'refund',
              p_method: mOrder.payment_method,
              p_reference_id: `ITEM-UNAVAIL-${item_id.substring(0, 8)}`,
              p_order_id: order_id,
              p_original_payment_id: originalPaymentId,
            }
          );

          if (!rpcError) {
            refundApplied = true;
          } else {
            console.error('Partial refund error:', rpcError);
          }
        }

        console.log(`[AUDIT] ${userRole} ${user.email} marked item ${item_id} unavailable on order ${order_id}. Refund: ${refundApplied ? '₱' + refundAmount : 'N/A'}. All unavailable: ${allUnavailable}`);

        return new Response(
          JSON.stringify({
            success: true,
            order_id,
            item_id,
            item_status: 'unavailable',
            new_total: newTotal,
            order_cancelled: allUnavailable,
            refund_applied: refundApplied,
            refund_amount: refundApplied ? refundAmount : 0,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'add-notes': {
        if (!order_id || !notes) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'order_id and notes are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Sanitize notes
        const sanitizedNotes = notes.trim().slice(0, 500);

        const { error: updateError } = await supabaseAdmin
          .from('orders')
          .update({ 
            notes: sanitizedNotes,
            updated_at: new Date().toISOString()
          })
          .eq('id', order_id);

        if (updateError) {
          return new Response(
            JSON.stringify({ error: 'UPDATE_FAILED', message: 'Failed to add notes' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] ${userRole} ${user.email} added notes to order ${order_id}`);

        return new Response(
          JSON.stringify({ success: true, order_id, notes: sanitizedNotes }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: 'INVALID_ACTION', message: 'Unknown action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'SERVER_ERROR', message: 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
