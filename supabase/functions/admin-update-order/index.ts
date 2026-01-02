// Admin Update Order Edge Function
// Secure server-side order status management

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type OrderStatus = 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled';

interface UpdateOrderRequest {
  order_id: string;
  status: OrderStatus;
  notes?: string;
}

// Valid status transitions
const validTransitions: Record<OrderStatus, OrderStatus[]> = {
  pending: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [], // Final state
  cancelled: [], // Final state
};

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

    // Check if user is admin or staff
    const userRole = user.user_metadata?.role;
    if (!['admin', 'staff'].includes(userRole)) {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Admin or staff access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: UpdateOrderRequest = await req.json();
    const { order_id, status, notes } = body;

    // Validate request
    if (!order_id || !status) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'order_id and status are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate status value
    const validStatuses: OrderStatus[] = ['pending', 'preparing', 'ready', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch current order
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, status, parent_id, total_amount')
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: 'ORDER_NOT_FOUND', message: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

    // If cancelled, restore stock
    if (status === 'cancelled' && currentStatus !== 'cancelled') {
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
            // Fallback: direct update if RPC doesn't exist
            supabaseAdmin
              .from('products')
              .update({ stock_quantity: supabaseAdmin.rpc('', {}) })
              .eq('id', item.product_id);
          });
        }
      }
    }

    // Log admin action
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

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'SERVER_ERROR', message: 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
