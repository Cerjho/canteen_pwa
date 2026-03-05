// Staff Place Order Edge Function
// Allows staff to create walk-in orders on behalf of parents.
// Walk-in orders are placed during service time and paid immediately (cash).
// No cutoff validation — staff can place orders at any time during operating hours.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';

function getPhilippineTime(): Date {
  const now = new Date();
  return new Date(now.getTime() + 8 * 60 * 60 * 1000);
}

function errorResponse(
  corsHeaders: Record<string, string>,
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
) {
  return new Response(
    JSON.stringify({ error: code, message, ...extra }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

interface WalkInItem {
  product_id: string;
  quantity: number;
  price_at_order: number;
  meal_period?: string;
}

interface StaffPlaceOrderRequest {
  parent_id: string;
  student_id: string;
  items: WalkInItem[];
  notes?: string;
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  const preflightResponse = handleCorsPreflight(req);
  if (preflightResponse) return preflightResponse;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return errorResponse(corsHeaders, 500, 'CONFIG_ERROR', 'Server configuration error');
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // ── Auth (must be staff or admin) ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse(corsHeaders, 401, 'UNAUTHORIZED', 'Missing authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return errorResponse(corsHeaders, 401, 'UNAUTHORIZED', 'Invalid token');
    }

    const userRole = user.app_metadata?.role;
    if (!['admin', 'staff'].includes(userRole)) {
      return errorResponse(corsHeaders, 403, 'FORBIDDEN', 'Staff or admin access required');
    }

    // ── Parse request ──
    const body: StaffPlaceOrderRequest = await req.json();
    const { parent_id, student_id, items, notes } = body;

    if (!parent_id || !student_id || !items || items.length === 0) {
      return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', 'Missing required fields: parent_id, student_id, items');
    }

    for (const item of items) {
      if (!item.product_id || item.quantity <= 0 || item.price_at_order < 0) {
        return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', 'Invalid item data');
      }
    }

    // ── System settings ──
    const { data: settingsData } = await supabaseAdmin.from('system_settings').select('key, value');
    const settings = new Map<string, unknown>();
    settingsData?.forEach(s => settings.set(s.key, s.value));

    if (settings.get('maintenance_mode') === true) {
      return errorResponse(corsHeaders, 503, 'MAINTENANCE_MODE', 'The canteen is currently under maintenance.');
    }

    // ── Verify parent-student link ──
    const { data: studentLink } = await supabaseAdmin
      .from('parent_students')
      .select('student_id')
      .eq('student_id', student_id)
      .eq('parent_id', parent_id)
      .single();

    if (!studentLink) {
      return errorResponse(corsHeaders, 400, 'INVALID_LINK', 'Parent is not linked to this student');
    }

    // ── Validate products ──
    const productIds = items.map(i => i.product_id);
    const { data: products, error: productsError } = await supabaseAdmin
      .from('products')
      .select('id, name, price, available')
      .in('id', productIds);

    if (productsError || !products) {
      return errorResponse(corsHeaders, 500, 'SERVER_ERROR', 'Failed to fetch products');
    }

    const productMap = new Map(products.map(p => [p.id, p]));
    let totalAmount = 0;

    for (const item of items) {
      const product = productMap.get(item.product_id);
      if (!product) {
        return errorResponse(corsHeaders, 400, 'PRODUCT_NOT_FOUND', 'Product not found', { product_id: item.product_id });
      }
      if (!product.available) {
        return errorResponse(corsHeaders, 400, 'PRODUCT_UNAVAILABLE', `'${product.name}' is not available`);
      }
      if (Math.abs(item.price_at_order - product.price) > 0.01) {
        return errorResponse(corsHeaders, 400, 'PRICE_MISMATCH', `Price changed for '${product.name}'. Please refresh.`);
      }
      totalAmount += product.price * item.quantity;
    }

    const phNow = getPhilippineTime();
    const todayStr = phNow.toISOString().split('T')[0];

    // ── Create walk-in order (immediately paid via cash) ──
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        parent_id,
        student_id,
        order_type: 'walk_in',
        status: 'pending', // Immediately ready for preparation
        payment_status: 'paid', // Cash confirmed by staff at POS
        total_amount: totalAmount,
        payment_method: 'cash',
        notes: notes ? `[Walk-in by ${user.email}] ${notes}` : `[Walk-in by ${user.email}]`,
        scheduled_for: todayStr,
        client_order_id: `WALKIN-${crypto.randomUUID().substring(0, 8)}-${todayStr}`,
      })
      .select('id')
      .single();

    if (orderError || !order) {
      console.error('Walk-in order insert error:', orderError);
      return errorResponse(corsHeaders, 500, 'ORDER_CREATION_FAILED', 'Failed to create walk-in order');
    }

    // ── Insert order items ──
    const orderItems = items.map(item => ({
      order_id: order.id,
      product_id: item.product_id,
      quantity: item.quantity,
      price_at_order: item.price_at_order,
      meal_period: item.meal_period || 'lunch',
    }));

    await supabaseAdmin.from('order_items').insert(orderItems);

    // ── Create completed payment record ──
    const { data: payment } = await supabaseAdmin
      .from('payments')
      .insert({
        parent_id,
        type: 'payment',
        amount_total: totalAmount,
        method: 'cash',
        status: 'completed',
        reference_id: `WALKIN-${order.id.substring(0, 8)}`,
      })
      .select('id')
      .single();

    if (payment) {
      await supabaseAdmin.from('payment_allocations').insert({
        payment_id: payment.id,
        order_id: order.id,
        allocated_amount: totalAmount,
      });
    }

    console.log(`[AUDIT] ${userRole} ${user.email} placed walk-in order ${order.id} for parent ${parent_id}, student ${student_id} (₱${totalAmount})`);

    return new Response(
      JSON.stringify({
        success: true,
        order_id: order.id,
        total_amount: totalAmount,
        status: 'pending',
        payment_status: 'paid',
        message: `Walk-in order created and paid (₱${totalAmount.toFixed(2)})`,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Unexpected error:', error);
    return errorResponse(corsHeaders, 500, 'SERVER_ERROR', 'An unexpected error occurred');
  }
});
