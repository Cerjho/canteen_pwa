// Manage Order Edge Function
// Secure server-side order management for admin and staff

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// Allow specific origins in production, fallback to * for development
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '*').split(',');

function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = ALLOWED_ORIGINS.includes('*') 
    ? '*' 
    : (origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

type OrderStatus = 'awaiting_payment' | 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled';
type Action = 'update-status' | 'cancel' | 'add-notes' | 'bulk-update-status';

interface ManageOrderRequest {
  action: Action;
  order_id?: string;
  order_ids?: string[]; // For bulk operations
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
        JSON.stringify({ error: 'FORBIDDEN', message: 'Admin or staff access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: ManageOrderRequest = await req.json();
    const { action, order_id, order_ids, status, notes, reason } = body;

    // Validate action
    const validActions: Action[] = ['update-status', 'cancel', 'add-notes', 'bulk-update-status'];
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

        // Update order to cancelled
        const { error: updateError } = await supabaseAdmin
          .from('orders')
          .update({ 
            status: 'cancelled',
            notes: reason ? `Cancelled: ${reason}` : 'Cancelled by staff/admin',
            updated_at: new Date().toISOString()
          })
          .eq('id', order_id);

        if (updateError) {
          return new Response(
            JSON.stringify({ error: 'UPDATE_FAILED', message: 'Failed to cancel order' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Restore stock
        const { data: orderItems } = await supabaseAdmin
          .from('order_items')
          .select('product_id, quantity')
          .eq('order_id', order_id);

        if (orderItems) {
          for (const item of orderItems) {
            await supabaseAdmin.rpc('increment_stock', { 
              p_product_id: item.product_id, 
              p_quantity: item.quantity 
            }).catch(() => {
              // If RPC doesn't exist, do direct update
              console.log('increment_stock RPC not available, skipping stock restore');
            });
          }
        }

        // If paid with balance, refund is handled separately via refund-order function
        // This function just cancels and restores stock

        console.log(`[AUDIT] ${userRole} ${user.email} cancelled order ${order_id}. Reason: ${reason || 'Not provided'}`);

        return new Response(
          JSON.stringify({
            success: true,
            order_id,
            previous_status: currentStatus,
            new_status: 'cancelled',
            refund_required: order.payment_method === 'balance'
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
