// Process Order Edge Function
// Idempotent order processing with stock validation and transaction support

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';

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
  meal_period?: string;
}

interface OrderRequest {
  parent_id: string;
  student_id: string;
  client_order_id: string;
  items: OrderItem[];
  payment_method: string;
  notes?: string;
  scheduled_for?: string;
  /** @deprecated Phase 3: meal_period moved to item level. Kept for backward compat. */
  meal_period?: string;
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  const preflightResponse = handleCorsPreflight(req);
  if (preflightResponse) return preflightResponse;

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

    // Only parents can place orders
    const userRole = user.app_metadata?.role;
    if (userRole !== 'parent') {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Only parents can place orders' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse and validate request body
    const body: OrderRequest = await req.json();
    const { parent_id, student_id, client_order_id, items, payment_method, notes, scheduled_for, meal_period } = body;

    // Ensure parent_id matches authenticated user (prevent impersonation)
    if (parent_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Cannot place orders on behalf of another user' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate request
    if (!parent_id || !student_id || !client_order_id || !items || items.length === 0) {
      console.error('Validation failed: Missing required fields', { parent_id: !!parent_id, student_id: !!student_id, client_order_id: !!client_order_id, items_count: items?.length });
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============================================
    // REJECT ONLINE PAYMENT METHODS
    // Online payments (gcash, paymaya, card) must use the create-checkout endpoint
    // ============================================
    const onlinePaymentMethods = ['gcash', 'paymaya', 'card'];
    if (onlinePaymentMethods.includes(payment_method)) {
      return new Response(
        JSON.stringify({
          error: 'WRONG_ENDPOINT',
          message: 'Online payments (GCash, PayMaya, Card) must use the create-checkout endpoint. This endpoint only handles cash and balance payments.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate payment method is cash or balance
    const validMethods = ['cash', 'balance'];
    if (!validMethods.includes(payment_method)) {
      return new Response(
        JSON.stringify({
          error: 'INVALID_PAYMENT_METHOD',
          message: `Invalid payment method '${payment_method}'. Allowed: cash, balance. For online payments, use the create-checkout endpoint.`,
        }),
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

    // ── Duplicate slot check (student_id × scheduled_for) ── Phase 4: auto-merge
    const slotDate = scheduled_for || todayStr;

    const { data: slotConflicts } = await supabaseAdmin
      .from('orders')
      .select('id, student_id, scheduled_for, status, total_amount')
      .eq('student_id', student_id)
      .eq('scheduled_for', slotDate)
      .not('status', 'eq', 'cancelled')
      .order('created_at', { ascending: true });

    if (slotConflicts && slotConflicts.length > 0) {
      const existingOrder = slotConflicts[0];
      const mergeableStatuses = ['pending', 'awaiting_payment'];

      // If order is not in a mergeable state, reject
      if (!mergeableStatuses.includes(existingOrder.status)) {
        console.log('Order locked, cannot merge:', existingOrder);
        return new Response(
          JSON.stringify({
            error: 'ORDER_LOCKED',
            message: `Order for this student and date is already ${existingOrder.status}. Cannot add items.`,
            order_id: existingOrder.id,
            status: existingOrder.status,
          }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // ── MERGE MODE: atomically append items using RPC (prevents race conditions) ──
      console.log('Merge mode: appending items to existing order', existingOrder.id);

      const mergeItems = items.map((item: OrderItem) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        price_at_order: item.price_at_order,
        meal_period: item.meal_period || 'lunch',
      }));

      const { data: mergeResult, error: mergeError } = await supabaseAdmin.rpc(
        'merge_order_items',
        {
          p_order_id: existingOrder.id,
          p_items: mergeItems,
          p_payment_method: payment_method,
          p_parent_id: parent_id,
        }
      );

      if (mergeError) {
        console.error('Merge RPC error:', mergeError);
        return new Response(
          JSON.stringify({ error: 'MERGE_FAILED', message: 'Failed to merge items into existing order. Please retry.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!mergeResult?.success) {
        const errorCode = mergeResult?.error || 'MERGE_FAILED';
        const errorMessage = mergeResult?.message || 'Merge failed';
        const statusCode = errorCode === 'MERGE_CONFLICT' ? 409
          : errorCode === 'INSUFFICIENT_BALANCE' ? 400
          : errorCode === 'NO_WALLET' ? 400
          : errorCode === 'ORDER_LOCKED' ? 409
          : 500;

        return new Response(
          JSON.stringify({ error: errorCode, message: errorMessage }),
          { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Return success with merge info — skip normal order creation
      console.log('Merge successful:', mergeResult);
      return new Response(
        JSON.stringify({
          success: true,
          merged: true,
          order_id: mergeResult.order_id,
          merged_order_ids: [mergeResult.order_id],
          total_amount: mergeResult.new_total,
          message: 'Items merged into existing order successfully',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

      // SECURITY: Validate client-provided price matches server price
      if (Math.abs(item.price_at_order - product.price) > 0.01) {
        return new Response(
          JSON.stringify({ 
            error: 'PRICE_MISMATCH', 
            message: `Price changed for '${product.name}'. Please refresh and try again.`,
            product_id: item.product_id,
            expected_price: product.price
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      totalAmount += product.price * item.quantity;
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

    // Deduct stock atomically using RPC, with rollback on partial failure
    const reservedProducts: Array<{ product_id: string; quantity: number }> = [];
    for (const item of items) {
      const { error: stockError } = await supabaseAdmin.rpc('decrement_stock', {
        p_product_id: item.product_id,
        p_quantity: item.quantity,
      });

      if (stockError) {
        console.error('Stock deduction failed:', item.product_id, stockError);
        // Rollback all previously reserved stock
        for (const reserved of reservedProducts) {
          await supabaseAdmin.rpc('increment_stock', {
            p_product_id: reserved.product_id,
            p_quantity: reserved.quantity,
          }).catch(err => console.error('Rollback failed for', reserved.product_id, err));
        }
        return new Response(
          JSON.stringify({ 
            error: 'STOCK_UPDATE_FAILED', 
            message: `Failed to reserve stock for '${productMap.get(item.product_id)?.name}'. Please retry.`,
            product_id: item.product_id
          }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      reservedProducts.push({ product_id: item.product_id, quantity: item.quantity });
    }

    // Helper to rollback all reserved stock
    const rollbackStock = async () => {
      for (const reserved of reservedProducts) {
        await supabaseAdmin.rpc('increment_stock', {
          p_product_id: reserved.product_id,
          p_quantity: reserved.quantity,
        }).catch(err => console.error('Rollback failed for', reserved.product_id, err));
      }
    };

    // Determine payment status and order status based on payment method
    // Cash: awaiting_payment until cashier confirms, with timeout
    // Balance: paid immediately, order goes to pending
    const isCashPayment = payment_method === 'cash';
    const CASH_PAYMENT_TIMEOUT_MINUTES = 240; // 4 hours to pay at cashier (configurable)
    
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
        scheduled_for: scheduled_for || getTodayPhilippines(),
        meal_period: null  // Phase 3: deprecated at order level, kept for backward compat
      })
      .select()
      .single();

    if (orderError || !order) {
      console.error('Order insert error:', orderError);
      await rollbackStock();
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
      price_at_order: item.price_at_order,
      meal_period: item.meal_period || 'lunch'
    }));

    const { error: itemsError } = await supabaseAdmin
      .from('order_items')
      .insert(orderItems);

    if (itemsError) {
      console.error('Order items insert error:', itemsError);
      // Rollback: delete order and restore stock
      await supabaseAdmin.from('orders').delete().eq('id', order.id);
      await rollbackStock();
      return new Response(
        JSON.stringify({ error: 'ORDER_ITEMS_FAILED', message: 'Failed to create order items' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Deduct balance if payment method is 'balance' — atomic RPC
    if (payment_method === 'balance') {
      const { data: rpcPaymentId, error: rpcError } = await supabaseAdmin.rpc(
        'deduct_balance_with_payment',
        {
          p_parent_id: parent_id,
          p_expected_balance: currentBalance,
          p_amount: totalAmount,
          p_order_ids: [order.id],
          p_order_amounts: [totalAmount],
        }
      );

      if (rpcError) {
        console.error('Atomic balance deduction error:', rpcError);
        // Rollback: restore stock and delete order
        await supabaseAdmin.from('order_items').delete().eq('order_id', order.id);
        await supabaseAdmin.from('orders').delete().eq('id', order.id);
        await rollbackStock();
        
        return new Response(
          JSON.stringify({ error: 'BALANCE_DEDUCTION_FAILED', message: 'Failed to deduct balance. Balance may have changed. Please retry.' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Insert payment record for non-balance methods (cash/online create pending payment)
    if (payment_method !== 'balance') {
      const { data: payment } = await supabaseAdmin
        .from('payments')
        .insert({
          parent_id,
          type: 'payment',
          amount_total: totalAmount,
          method: payment_method,
          status: 'pending',
        })
        .select('id')
        .single();

      // Link payment to order via allocation
      if (payment) {
        await supabaseAdmin
          .from('payment_allocations')
          .insert({
            payment_id: payment.id,
            order_id: order.id,
            allocated_amount: totalAmount,
          });
      }
    }

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
