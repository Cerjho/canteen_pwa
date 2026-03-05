// Create Weekly Checkout Edge Function
// Creates a weekly_order + 5 daily orders + a SINGLE PayMongo Checkout Session.
// Online payment path (gcash/paymaya/card) for weekly pre-orders.
//
// Flow:
//   1. Validate weekly cutoff (Friday 5PM Manila time)
//   2. Validate parent-student link, items, dates
//   3. Create weekly_orders record
//   4. Create 5 daily orders + order_items
//   5. Create pending payment + allocations
//   6. Create PayMongo checkout session with weekly_order_id in metadata
//   7. Return checkout_url

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import {
  createCheckoutSession,
  toCentavos,
  mapPaymentMethodTypes,
} from '../_shared/paymongo.ts';

// ── Helpers ──

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

// ── Interfaces ──

interface DayOrder {
  scheduled_for: string;
  items: Array<{
    product_id: string;
    quantity: number;
    price_at_order: number;
    meal_period?: string;
  }>;
}

interface WeeklyCheckoutRequest {
  parent_id: string;
  student_id: string;
  week_start: string; // Monday YYYY-MM-DD
  days: DayOrder[];
  payment_method: 'gcash' | 'paymaya' | 'card';
  notes?: string;
}

const ONLINE_PAYMENT_TIMEOUT_MINUTES = 30;

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

    // ── Auth ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse(corsHeaders, 401, 'UNAUTHORIZED', 'Missing or invalid authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return errorResponse(corsHeaders, 401, 'UNAUTHORIZED', 'Session expired or invalid. Please sign in again.');
    }

    if (user.app_metadata?.role !== 'parent') {
      return errorResponse(corsHeaders, 403, 'FORBIDDEN', 'Only parents can place weekly orders');
    }

    // ── Parse & validate request ──
    const body: WeeklyCheckoutRequest = await req.json();
    const { parent_id, student_id, week_start, days, payment_method, notes } = body;

    if (parent_id !== user.id) {
      return errorResponse(corsHeaders, 403, 'FORBIDDEN', 'Cannot place orders on behalf of another user');
    }

    if (!parent_id || !student_id || !week_start || !days || days.length === 0) {
      return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', 'Missing required fields: parent_id, student_id, week_start, days');
    }

    const validOnlineMethods = ['gcash', 'paymaya', 'card'];
    if (!validOnlineMethods.includes(payment_method)) {
      return errorResponse(corsHeaders, 400, 'INVALID_PAYMENT_METHOD', 'Use process-weekly-order for cash payments.');
    }

    if (days.length > 6) {
      return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', 'Weekly order can have at most 6 days (Mon-Sat)');
    }

    // Validate week_start is a Monday
    const weekStartDate = new Date(week_start + 'T00:00:00');
    if (weekStartDate.getDay() !== 1) {
      return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', 'week_start must be a Monday');
    }

    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekEndDate.getDate() + 5); // Saturday (for makeup days)
    const weekEndStr = weekEndDate.toISOString().split('T')[0];

    for (const day of days) {
      if (!day.scheduled_for || !day.items || day.items.length === 0) {
        return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', 'Each day must have scheduled_for and items');
      }
      if (day.scheduled_for < week_start || day.scheduled_for > weekEndStr) {
        return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', `Date ${day.scheduled_for} is outside the target week`);
      }
      const dow = new Date(day.scheduled_for + 'T00:00:00').getDay();
      if (dow === 0) {
        return errorResponse(corsHeaders, 400, 'INVALID_DATE', `${day.scheduled_for} is a Sunday`);
      }
      if (dow === 6) {
        // Saturday — only allowed if it's a makeup day
        const { data: makeupDay } = await supabaseAdmin
          .from('makeup_days')
          .select('id')
          .eq('date', day.scheduled_for)
          .maybeSingle();
        if (!makeupDay) {
          return errorResponse(corsHeaders, 400, 'INVALID_DATE', `${day.scheduled_for} is a Saturday and not a makeup day`);
        }
      }
      for (const item of day.items) {
        if (!item.product_id || item.quantity <= 0 || item.price_at_order < 0) {
          return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', 'Invalid item data');
        }
      }
    }

    // ── System settings ──
    const { data: settingsData } = await supabaseAdmin.from('system_settings').select('key, value');
    const settings = new Map<string, unknown>();
    settingsData?.forEach(s => settings.set(s.key, s.value));

    if (settings.get('maintenance_mode') === true) {
      return errorResponse(corsHeaders, 503, 'MAINTENANCE_MODE', 'The canteen is currently under maintenance.');
    }

    // ── Validate weekly cutoff ──
    const cutoffDay = (settings.get('weekly_cutoff_day') as string) || 'Friday';
    const cutoffTime = (settings.get('weekly_cutoff_time') as string) || '17:00';

    const phNow = getPhilippineTime();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentTimeStr = phNow.toISOString().substring(11, 16);

    const cutoffDayIndex = dayNames.indexOf(cutoffDay);
    const currentDayIndex = phNow.getDay();

    const todayStr = phNow.toISOString().split('T')[0];
    if (week_start <= todayStr) {
      return errorResponse(corsHeaders, 400, 'PAST_WEEK', 'Cannot order for current or past weeks.');
    }

    if (currentDayIndex > cutoffDayIndex || (currentDayIndex === cutoffDayIndex && currentTimeStr >= cutoffTime)) {
      const daysUntilNextMonday = (8 - currentDayIndex) % 7 || 7;
      const nextMonday = new Date(phNow);
      nextMonday.setDate(nextMonday.getDate() + daysUntilNextMonday);
      const nextMondayStr = nextMonday.toISOString().split('T')[0];

      if (week_start === nextMondayStr) {
        return errorResponse(corsHeaders, 400, 'PAST_CUTOFF',
          `Weekly order cutoff (${cutoffDay} ${cutoffTime}) has passed for the week of ${week_start}.`);
      }
    }

    // ── Verify parent-student link ──
    const { data: studentLink } = await supabaseAdmin
      .from('parent_students')
      .select('student_id')
      .eq('student_id', student_id)
      .eq('parent_id', parent_id)
      .single();

    if (!studentLink) {
      return errorResponse(corsHeaders, 401, 'UNAUTHORIZED', 'Parent is not linked to this student');
    }

    // ── Duplicate check ──
    const { data: existingWeekly } = await supabaseAdmin
      .from('weekly_orders')
      .select('id, status, paymongo_checkout_id')
      .eq('student_id', student_id)
      .eq('week_start', week_start)
      .neq('status', 'cancelled')
      .limit(1)
      .single();

    if (existingWeekly) {
      // If existing and still awaiting payment with checkout URL, return it (idempotent)
      if (existingWeekly.paymongo_checkout_id) {
        try {
          const { getCheckoutSession: getSession } = await import('../_shared/paymongo.ts');
          const session = await getSession(existingWeekly.paymongo_checkout_id);
          return new Response(
            JSON.stringify({
              success: true,
              weekly_order_id: existingWeekly.id,
              checkout_url: session.attributes.checkout_url,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        } catch { /* session expired, fall through to duplicate error */ }
      }
      return errorResponse(corsHeaders, 409, 'DUPLICATE_WEEKLY_ORDER',
        `A weekly order already exists for this student for the week of ${week_start}`,
        { existing_weekly_order_id: existingWeekly.id });
    }

    // ── Validate products ──
    const allProductIds = [...new Set(days.flatMap(d => d.items.map(i => i.product_id)))];
    const { data: products, error: productsError } = await supabaseAdmin
      .from('products')
      .select('id, name, price, available')
      .in('id', allProductIds);

    if (productsError || !products) {
      return errorResponse(corsHeaders, 500, 'SERVER_ERROR', 'Failed to fetch products');
    }

    const productMap = new Map(products.map(p => [p.id, p]));
    let weeklyTotal = 0;
    const lineItems: Array<{ name: string; quantity: number; amount: number; currency: string }> = [];
    const combinedItems = new Map<string, { name: string; quantity: number; amount: number }>();

    for (const day of days) {
      for (const item of day.items) {
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
        weeklyTotal += product.price * item.quantity;

        const existing = combinedItems.get(product.id);
        if (existing) {
          existing.quantity += item.quantity;
        } else {
          combinedItems.set(product.id, { name: product.name, quantity: item.quantity, amount: toCentavos(product.price) });
        }
      }
    }

    for (const item of combinedItems.values()) {
      lineItems.push({ ...item, currency: 'PHP' });
    }

    // PayMongo minimum ₱20
    if (weeklyTotal < 20) {
      return errorResponse(corsHeaders, 400, 'MINIMUM_AMOUNT', 'Minimum order amount is ₱20 for online payment.');
    }

    // ── Validate dates against holidays ──
    const { data: holidays } = await supabaseAdmin.from('holidays').select('id, name, date, is_recurring');
    for (const day of days) {
      const holiday = holidays?.find(h => {
        const hd = h.date.split('T')[0];
        return h.is_recurring ? hd.slice(5) === day.scheduled_for.slice(5) : hd === day.scheduled_for;
      });
      if (holiday) {
        return errorResponse(corsHeaders, 400, 'HOLIDAY', `The canteen is closed on ${holiday.name} (${day.scheduled_for}).`);
      }
    }

    console.log('Creating weekly checkout:', { parent_id, student_id, week_start, days_count: days.length, total: weeklyTotal });

    // ── Create weekly_orders record ──
    const paymentDueAt = new Date(Date.now() + ONLINE_PAYMENT_TIMEOUT_MINUTES * 60 * 1000).toISOString();

    const { data: weeklyOrder, error: woError } = await supabaseAdmin
      .from('weekly_orders')
      .insert({
        parent_id,
        student_id,
        week_start,
        total_amount: weeklyTotal,
        payment_method,
        payment_status: 'awaiting_payment',
        payment_due_at: paymentDueAt,
        status: 'active',
        notes: notes || null,
      })
      .select('id')
      .single();

    if (woError || !weeklyOrder) {
      console.error('Weekly order insert error:', woError);
      return errorResponse(corsHeaders, 500, 'ORDER_CREATION_FAILED', 'Failed to create weekly order');
    }

    // ── Create daily orders ──
    const dailyOrderRows = days.map(day => {
      const dayTotal = day.items.reduce((sum, item) => {
        const product = productMap.get(item.product_id)!;
        return sum + product.price * item.quantity;
      }, 0);

      return {
        parent_id,
        student_id,
        weekly_order_id: weeklyOrder.id,
        order_type: 'pre_order',
        status: 'awaiting_payment',
        payment_status: 'awaiting_payment',
        payment_due_at: paymentDueAt,
        total_amount: dayTotal,
        payment_method,
        notes: notes || null,
        scheduled_for: day.scheduled_for,
        client_order_id: `WO-${weeklyOrder.id.substring(0, 8)}-${day.scheduled_for}`,
      };
    });

    const { data: createdOrders, error: ordersError } = await supabaseAdmin
      .from('orders')
      .insert(dailyOrderRows)
      .select('id, scheduled_for, total_amount');

    if (ordersError || !createdOrders) {
      console.error('Daily orders insert error:', ordersError);
      await supabaseAdmin.from('weekly_orders').delete().eq('id', weeklyOrder.id);
      return errorResponse(corsHeaders, 500, 'ORDER_CREATION_FAILED', 'Failed to create daily orders');
    }

    const orderByDate = new Map(createdOrders.map(o => [o.scheduled_for, o.id]));
    const createdOrderIds = createdOrders.map(o => o.id);

    // ── Insert order items ──
    const allOrderItems = days.flatMap(day => {
      const orderId = orderByDate.get(day.scheduled_for);
      if (!orderId) return [];
      return day.items.map(item => ({
        order_id: orderId,
        product_id: item.product_id,
        quantity: item.quantity,
        price_at_order: item.price_at_order,
        meal_period: item.meal_period || 'lunch',
      }));
    });

    const { error: itemsError } = await supabaseAdmin.from('order_items').insert(allOrderItems);
    if (itemsError) {
      console.error('Order items insert error:', itemsError);
      await supabaseAdmin.from('orders').delete().in('id', createdOrderIds);
      await supabaseAdmin.from('weekly_orders').delete().eq('id', weeklyOrder.id);
      return errorResponse(corsHeaders, 500, 'ORDER_ITEMS_FAILED', 'Failed to create order items');
    }

    // ── Create payment record ──
    const { data: payment } = await supabaseAdmin
      .from('payments')
      .insert({
        parent_id,
        type: 'payment',
        amount_total: weeklyTotal,
        method: payment_method,
        status: 'pending',
        weekly_order_id: weeklyOrder.id,
      })
      .select('id')
      .single();

    if (payment) {
      const allocations = createdOrders.map(o => ({
        payment_id: payment.id,
        order_id: o.id,
        allocated_amount: o.total_amount,
      }));
      await supabaseAdmin.from('payment_allocations').insert(allocations);
    }

    // ── Create PayMongo Checkout Session ──
    let checkoutSession;
    try {
      const appUrl = Deno.env.get('APP_URL') || 'http://localhost:5173';
      const successUrl = `${appUrl}/order-confirmation?payment=success&weekly_order_id=${weeklyOrder.id}`;
      const cancelUrl = `${appUrl}/order-confirmation?payment=cancelled&weekly_order_id=${weeklyOrder.id}`;

      const { data: student } = await supabaseAdmin
        .from('students')
        .select('first_name')
        .eq('id', student_id)
        .single();

      const description = `LOHECA Canteen — Weekly Order for ${student?.first_name || 'Student'} (${week_start})`;

      checkoutSession = await createCheckoutSession({
        lineItems,
        paymentMethodTypes: mapPaymentMethodTypes(payment_method),
        description,
        metadata: {
          type: 'order',
          weekly_order_id: weeklyOrder.id,
          order_id: createdOrderIds[0], // Primary for backwards compat
          parent_id,
        },
        successUrl,
        cancelUrl,
      });

      // Save checkout ID on weekly order
      await supabaseAdmin
        .from('weekly_orders')
        .update({ paymongo_checkout_id: checkoutSession.id })
        .eq('id', weeklyOrder.id);

      // Save checkout ID on all daily orders
      await supabaseAdmin
        .from('orders')
        .update({ paymongo_checkout_id: checkoutSession.id })
        .in('id', createdOrderIds);

    } catch (paymongoErr) {
      console.error('PayMongo checkout creation failed:', paymongoErr);
      // Rollback everything
      await supabaseAdmin.from('order_items').delete().in('order_id', createdOrderIds);
      if (payment) {
        await supabaseAdmin.from('payment_allocations').delete().eq('payment_id', payment.id);
        await supabaseAdmin.from('payments').delete().eq('id', payment.id);
      }
      await supabaseAdmin.from('orders').delete().in('id', createdOrderIds);
      await supabaseAdmin.from('weekly_orders').delete().eq('id', weeklyOrder.id);

      return errorResponse(corsHeaders, 502, 'PAYMENT_ERROR', 'Online payments are temporarily unavailable. Please use cash.');
    }

    console.log('Weekly checkout created:', {
      weekly_order_id: weeklyOrder.id,
      checkout_id: checkoutSession.id,
      daily_orders: createdOrderIds.length,
      total: weeklyTotal,
    });

    return new Response(
      JSON.stringify({
        success: true,
        weekly_order_id: weeklyOrder.id,
        order_ids: createdOrderIds,
        checkout_url: checkoutSession.attributes.checkout_url,
        payment_due_at: paymentDueAt,
        total_amount: weeklyTotal,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Unexpected error:', error);
    return errorResponse(corsHeaders, 500, 'SERVER_ERROR', 'An unexpected error occurred');
  }
});
