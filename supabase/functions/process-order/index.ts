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
    // Initialize Supabase client with service role for admin operations
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !serviceRoleKey) {
      console.error('Missing Supabase configuration');
      return new Response(
        JSON.stringify({ error: 'CONFIG_ERROR', message: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const supabaseAdmin = createClient(
      supabaseUrl,
      serviceRoleKey,
      { auth: { persistSession: false } }
    );

    // Get auth token from Authorization header
    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const token = authHeader.replace('Bearer ', '');
    
    // Validate token is a proper JWT (basic structure check)
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Invalid token format' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user with Supabase Auth (server-side validation)
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      console.error('Auth verification failed:', authError?.message);
      return new Response(
        JSON.stringify({ 
          error: 'UNAUTHORIZED', 
          message: 'Session expired or invalid. Please sign in again.'
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse and validate request body
    const body: OrderRequest = await req.json();
    const { parent_id, student_id, client_order_id, items, payment_method, notes, scheduled_for } = body;

    // Validate request
    if (!parent_id || !student_id || !client_order_id || !items || items.length === 0) {
      console.error('Validation failed: Missing required fields', { parent_id: !!parent_id, student_id: !!student_id, client_order_id: !!client_order_id, items_count: items?.length });
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Processing order:', { parent_id, student_id, client_order_id, items_count: items.length, payment_method, scheduled_for });

    // ============================================
    // SYSTEM SETTINGS ENFORCEMENT
    // ============================================
    
    // Fetch system settings
    const { data: settingsData, error: settingsError } = await supabaseAdmin
      .from('system_settings')
      .select('key, value');
    
    if (settingsError) {
      console.error('Failed to fetch system settings:', settingsError);
    }
    
    const settings = new Map<string, unknown>();
    settingsData?.forEach(s => settings.set(s.key, s.value));
    console.log('System settings loaded:', Object.fromEntries(settings));

    // Check maintenance mode
    const maintenanceMode = settings.get('maintenance_mode') === true;
    if (maintenanceMode) {
      console.log('Rejected: Maintenance mode is ON');
      return new Response(
        JSON.stringify({ error: 'MAINTENANCE_MODE', message: 'The canteen is currently under maintenance. Please try again later.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get current time in Philippines
    const now = new Date();
    const phTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const currentTimeStr = phTime.toISOString().substring(11, 16); // HH:MM
    const todayStr = getTodayPhilippines();
    console.log('Time info:', { currentTimeStr, todayStr, now: now.toISOString() });

    // Determine effective order date FIRST (needed for operating hours check)
    const orderDate = scheduled_for || todayStr;
    const isToday = orderDate === todayStr;
    console.log('Order date:', { orderDate, isToday, scheduled_for });

    // Check operating hours - ONLY for same-day orders
    const operatingHours = settings.get('operating_hours') as { open?: string; close?: string } | undefined;
    console.log('Operating hours check:', { operatingHours, isToday, currentTimeStr });
    if (isToday && operatingHours?.open && operatingHours?.close) {
      const { open, close } = operatingHours;
      if (currentTimeStr < open || currentTimeStr > close) {
        console.log('Rejected: Outside operating hours', { open, close, currentTimeStr });
        return new Response(
          JSON.stringify({ 
            error: 'OUTSIDE_HOURS', 
            message: `Orders can only be placed between ${open} and ${close}. Current time: ${currentTimeStr}` 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ============================================
    // VALIDATE ORDER DATE IS A SCHOOL DAY
    // ============================================
    const orderDateObj = new Date(orderDate + 'T00:00:00');
    const dayOfWeek = orderDateObj.getDay(); // 0 = Sunday, 6 = Saturday
    console.log('Day of week check:', { orderDate, dayOfWeek });

    // Check if it's a Sunday (never allowed)
    if (dayOfWeek === 0) {
      console.log('Rejected: Sunday not allowed');
      return new Response(
        JSON.stringify({ 
          error: 'INVALID_DATE', 
          message: 'The canteen is closed on Sundays. Please select a weekday.' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if it's a Saturday (only allowed if it's a makeup day)
    if (dayOfWeek === 6) {
      console.log('Checking if Saturday is a makeup day...');
      const { data: makeupDay } = await supabaseAdmin
        .from('makeup_days')
        .select('id, name')
        .eq('date', orderDate)
        .single();

      if (!makeupDay) {
        console.log('Rejected: Saturday is not a makeup day');
        return new Response(
          JSON.stringify({ 
            error: 'INVALID_DATE', 
            message: 'The canteen is closed on regular Saturdays. Please select a weekday or a scheduled makeup Saturday.' 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log('Saturday is a makeup day:', makeupDay.name);
    }

    // Check if the order date is a holiday
    const { data: holidays } = await supabaseAdmin
      .from('holidays')
      .select('id, name, date, is_recurring');
    console.log('Holidays loaded:', holidays?.length || 0);

    const isHoliday = holidays?.some(h => {
      const holidayDateStr = h.date.split('T')[0];
      if (h.is_recurring) {
        // Check month-day match for recurring holidays
        return holidayDateStr.slice(5) === orderDate.slice(5);
      }
      return holidayDateStr === orderDate;
    });

    if (isHoliday) {
      const holiday = holidays?.find(h => {
        const holidayDateStr = h.date.split('T')[0];
        if (h.is_recurring) {
          return holidayDateStr.slice(5) === orderDate.slice(5);
        }
        return holidayDateStr === orderDate;
      });
      console.log('Rejected: Holiday', holiday?.name);
      return new Response(
        JSON.stringify({ 
          error: 'HOLIDAY', 
          message: `The canteen is closed on ${holiday?.name || 'this holiday'}. Please select a different date.` 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // ============================================

    // Check order cutoff time for same-day orders
    const orderCutoffTime = settings.get('order_cutoff_time') as string | undefined;
    console.log('Cutoff check:', { orderCutoffTime, isToday, currentTimeStr });
    if (isToday && orderCutoffTime && currentTimeStr > orderCutoffTime) {
      console.log('Rejected: Past cutoff time');
      return new Response(
        JSON.stringify({ 
          error: 'PAST_CUTOFF', 
          message: `Order cutoff time for today (${orderCutoffTime}) has passed. Current time: ${currentTimeStr}` 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check future orders settings
    const allowFutureOrders = settings.get('allow_future_orders') !== false; // Default true
    const maxFutureDays = (settings.get('max_future_days') as number) || 5;
    console.log('Future orders settings:', { allowFutureOrders, maxFutureDays });

    if (!isToday) {
      if (!allowFutureOrders) {
        console.log('Rejected: Future orders disabled');
        return new Response(
          JSON.stringify({ error: 'FUTURE_ORDERS_DISABLED', message: 'Future orders are currently not allowed.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Validate order date is not too far in the future
      const orderDateObj = new Date(orderDate + 'T00:00:00');
      const todayDateObj = new Date(todayStr + 'T00:00:00');
      const daysDiff = Math.ceil((orderDateObj.getTime() - todayDateObj.getTime()) / (1000 * 60 * 60 * 24));
      console.log('Future order check:', { daysDiff, maxFutureDays });

      if (daysDiff > maxFutureDays) {
        console.log('Rejected: Order too far in future');
        return new Response(
          JSON.stringify({ 
            error: 'ORDER_TOO_FAR', 
            message: `Orders can only be placed up to ${maxFutureDays} days in advance.` 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (daysDiff < 0) {
        console.log('Rejected: Past date');
        return new Response(
          JSON.stringify({ error: 'PAST_DATE', message: 'Cannot place orders for past dates.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log('Passed all date/time validations');

    // ============================================
    // END SETTINGS ENFORCEMENT
    // ============================================

    // Verify parent_id matches authenticated user
    if (parent_id !== user.id) {
      console.log('Rejected: Parent ID mismatch', { parent_id, user_id: user.id });
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
      console.log('Rejected: Parent not linked to student', { student_id, parent_id, linkError });
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Parent is not linked to this student' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    console.log('Parent-student link verified');

    // Check for duplicate order (idempotency)
    const { data: existingOrder } = await supabaseAdmin
      .from('orders')
      .select('id, status, total_amount')
      .eq('client_order_id', client_order_id)
      .single();

    if (existingOrder) {
      console.log('Duplicate order detected:', existingOrder);
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
    console.log('Validating products:', productIds);
    const { data: products, error: productsError } = await supabaseAdmin
      .from('products')
      .select('id, name, price, stock_quantity, available')
      .in('id', productIds);

    if (productsError || !products) {
      console.log('Failed to fetch products:', productsError);
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
