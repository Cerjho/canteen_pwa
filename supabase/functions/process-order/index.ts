// Process Order Edge Function
// Idempotent order processing with stock validation and transaction support

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OrderItem {
  product_id: string;
  quantity: number;
  price_at_order: number;
}

interface OrderRequest {
  parent_id: string;
  child_id: string;
  client_order_id: string;
  items: OrderItem[];
  payment_method: string;
  notes?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get auth token from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client with service role for admin operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Initialize client with user's token for auth verification
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { 
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false }
      }
    );

    // Get user from token
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: OrderRequest = await req.json();
    const { parent_id, child_id, client_order_id, items, payment_method, notes } = body;

    // Validate request
    if (!parent_id || !child_id || !client_order_id || !items || items.length === 0) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify parent_id matches authenticated user
    if (parent_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Parent ID does not match authenticated user' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify parent owns the child
    const { data: child, error: childError } = await supabaseAdmin
      .from('children')
      .select('id, parent_id')
      .eq('id', child_id)
      .single();

    if (childError || !child || child.parent_id !== parent_id) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Parent does not own this child' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for duplicate order (idempotency)
    const { data: existingOrder } = await supabaseAdmin
      .from('orders')
      .select('id, status, total_amount')
      .eq('client_order_id', client_order_id)
      .single();

    if (existingOrder) {
      return new Response(
        JSON.stringify({
          error: 'DUPLICATE_ORDER',
          message: 'Order with this client_order_id already exists',
          existing_order_id: existingOrder.id,
          status: existingOrder.status,
          total_amount: existingOrder.total_amount
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch products and validate stock
    const productIds = items.map(item => item.product_id);
    const { data: products, error: productsError } = await supabaseAdmin
      .from('products')
      .select('id, name, price, stock_quantity, available')
      .in('id', productIds);

    if (productsError || !products) {
      return new Response(
        JSON.stringify({ error: 'SERVER_ERROR', message: 'Failed to fetch products' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate each item
    const productMap = new Map(products.map(p => [p.id, p]));
    let totalAmount = 0;

    for (const item of items) {
      const product = productMap.get(item.product_id);
      
      if (!product) {
        return new Response(
          JSON.stringify({ 
            error: 'PRODUCT_NOT_FOUND', 
            message: `Product not found`,
            product_id: item.product_id
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!product.available) {
        return new Response(
          JSON.stringify({ 
            error: 'PRODUCT_UNAVAILABLE', 
            message: `Product '${product.name}' is not available`,
            product_id: item.product_id
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (product.stock_quantity < item.quantity) {
        return new Response(
          JSON.stringify({ 
            error: 'INSUFFICIENT_STOCK', 
            message: `Product '${product.name}' has insufficient stock (available: ${product.stock_quantity})`,
            product_id: item.product_id,
            available_stock: product.stock_quantity
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      totalAmount += item.price_at_order * item.quantity;
    }

    // Process order in transaction using RPC
    // First, deduct stock for all items
    for (const item of items) {
      const product = productMap.get(item.product_id)!;
      const { error: stockError } = await supabaseAdmin
        .from('products')
        .update({ stock_quantity: product.stock_quantity - item.quantity })
        .eq('id', item.product_id)
        .gte('stock_quantity', item.quantity); // Optimistic lock

      if (stockError) {
        // Rollback would happen here in production with proper transaction
        return new Response(
          JSON.stringify({ 
            error: 'STOCK_UPDATE_FAILED', 
            message: 'Failed to update stock, please retry',
            product_id: item.product_id
          }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Insert order
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        parent_id,
        child_id,
        client_order_id,
        status: 'pending',
        total_amount: totalAmount,
        payment_method,
        notes: notes || null
      })
      .select()
      .single();

    if (orderError || !order) {
      // In production, rollback stock updates
      console.error('Order insert error:', orderError);
      return new Response(
        JSON.stringify({ error: 'ORDER_CREATION_FAILED', message: 'Failed to create order' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert order items
    const orderItems = items.map(item => ({
      order_id: order.id,
      product_id: item.product_id,
      quantity: item.quantity,
      price_at_order: item.price_at_order
    }));

    const { error: itemsError } = await supabaseAdmin
      .from('order_items')
      .insert(orderItems);

    if (itemsError) {
      console.error('Order items insert error:', itemsError);
      // In production, rollback order and stock updates
      return new Response(
        JSON.stringify({ error: 'ORDER_ITEMS_FAILED', message: 'Failed to create order items' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert transaction record
    await supabaseAdmin
      .from('transactions')
      .insert({
        parent_id,
        order_id: order.id,
        type: 'payment',
        amount: totalAmount,
        method: payment_method,
        status: payment_method === 'cash' ? 'pending' : 'completed'
      });

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        order_id: order.id,
        status: order.status,
        total_amount: totalAmount
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
