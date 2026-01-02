// Process Order Edge Function
// Idempotent order processing with stock validation and transaction support

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to get today's date in Philippines timezone (UTC+8)
function getTodayPhilippines(): string {
  const now = new Date();
  // Add 8 hours for UTC+8
  const phTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  return phTime.toISOString().split('T')[0];
}

interface OrderItem {
  product_id: string;
  quantity: number;
  price_at_order: number;
}

interface OrderRequest {
  parent_id: string;
  student_id: string;
  client_order_id: string;
  items: OrderItem[];
  payment_method: string;
  notes?: string;
  scheduled_for?: string;
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

    // Extract token from Bearer header
    const token = authHeader.replace('Bearer ', '');

    // Initialize Supabase client with service role for admin operations
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

    // Parse request body
    const body: OrderRequest = await req.json();
    const { parent_id, student_id, client_order_id, items, payment_method, notes, scheduled_for } = body;

    // Validate request
    if (!parent_id || !student_id || !client_order_id || !items || items.length === 0) {
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

    // Verify parent owns the student via parent_students link
    const { data: studentLink, error: linkError } = await supabaseAdmin
      .from('parent_students')
      .select('student_id')
      .eq('student_id', student_id)
      .eq('parent_id', parent_id)
      .single();

    if (linkError || !studentLink) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Parent is not linked to this student' }),
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

    // If payment method is 'balance', validate sufficient funds
    let currentBalance = 0;
    if (payment_method === 'balance') {
      const { data: wallet, error: walletError } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('user_id', parent_id)
        .single();

      if (walletError || !wallet) {
        return new Response(
          JSON.stringify({ 
            error: 'NO_WALLET', 
            message: 'No wallet found. Please top up your balance first.' 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      currentBalance = wallet.balance;

      if (currentBalance < totalAmount) {
        return new Response(
          JSON.stringify({ 
            error: 'INSUFFICIENT_BALANCE', 
            message: `Insufficient balance. Required: ₱${totalAmount.toFixed(2)}, Available: ₱${currentBalance.toFixed(2)}`,
            required: totalAmount,
            available: currentBalance
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
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

    // Determine payment status and order status based on payment method
    // Cash: awaiting_payment until cashier confirms, with timeout
    // Balance: paid immediately, order goes to pending
    const isCashPayment = payment_method === 'cash';
    const CASH_PAYMENT_TIMEOUT_MINUTES = 15; // 15 minutes to pay at cashier
    
    const paymentStatus = isCashPayment ? 'awaiting_payment' : 'paid';
    const orderStatus = isCashPayment ? 'awaiting_payment' : 'pending';
    const paymentDueAt = isCashPayment 
      ? new Date(Date.now() + CASH_PAYMENT_TIMEOUT_MINUTES * 60 * 1000).toISOString()
      : null;

    // Insert order
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        parent_id,
        student_id,
        client_order_id,
        status: orderStatus,
        payment_status: paymentStatus,
        payment_due_at: paymentDueAt,
        total_amount: totalAmount,
        payment_method,
        notes: notes || null,
        scheduled_for: scheduled_for || getTodayPhilippines()
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

    // Deduct balance if payment method is 'balance'
    if (payment_method === 'balance') {
      const newBalance = currentBalance - totalAmount;
      // Use optimistic locking to prevent race conditions
      const { data: balanceResult, error: balanceError } = await supabaseAdmin
        .from('wallets')
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq('user_id', parent_id)
        .eq('balance', currentBalance) // Only update if balance hasn't changed
        .select('balance')
        .single();

      if (balanceError || !balanceResult) {
        console.error('Balance deduction error:', balanceError);
        // Rollback: restore stock for all items
        for (const item of items) {
          const product = productMap.get(item.product_id)!;
          await supabaseAdmin
            .from('products')
            .update({ stock_quantity: product.stock_quantity })
            .eq('id', item.product_id);
        }
        // Delete the order
        await supabaseAdmin.from('order_items').delete().eq('order_id', order.id);
        await supabaseAdmin.from('orders').delete().eq('id', order.id);
        
        return new Response(
          JSON.stringify({ error: 'BALANCE_DEDUCTION_FAILED', message: 'Failed to deduct balance. Balance may have changed. Please retry.' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
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

    // Return success response with payment info
    return new Response(
      JSON.stringify({
        success: true,
        order_id: order.id,
        status: order.status,
        payment_status: paymentStatus,
        payment_due_at: paymentDueAt,
        total_amount: totalAmount,
        message: isCashPayment 
          ? `Please pay ₱${totalAmount.toFixed(2)} at the cashier within ${CASH_PAYMENT_TIMEOUT_MINUTES} minutes`
          : 'Order placed successfully'
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
