// Process Weekly Order Edge Function
// Creates a weekly_order + 5 daily orders for the NEXT school week (Mon-Fri).
// Cash payment path — online payments use create-weekly-checkout.
//
// Flow:
//   1. Validate weekly cutoff (Friday 5PM Manila time)
//   2. Validate parent-student link, items, dates
//   3. Create weekly_orders record
//   4. Create 5 daily orders + order_items
//   5. Create pending payment + allocations
//   6. Return weekly_order_id + daily order IDs

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';

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
  /** YYYY-MM-DD — must be Mon-Fri of the target week */
  scheduled_for: string;
  items: Array<{
    product_id: string;
    quantity: number;
    price_at_order: number;
    meal_period?: string;
  }>;
}

interface WeeklyOrderRequest {
  parent_id: string;
  student_id: string;
  week_start: string; // Monday YYYY-MM-DD
  days: DayOrder[];
  payment_method: 'cash';
  notes?: string;
}

const CASH_PAYMENT_TIMEOUT_MINUTES = 4 * 60; // 4 hours

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
    const body: WeeklyOrderRequest = await req.json();
    const { parent_id, student_id, week_start, days, payment_method, notes } = body;

    if (parent_id !== user.id) {
      return errorResponse(corsHeaders, 403, 'FORBIDDEN', 'Cannot place orders on behalf of another user');
    }

    if (!parent_id || !student_id || !week_start || !days || days.length === 0) {
      return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', 'Missing required fields: parent_id, student_id, week_start, days');
    }

    if (payment_method !== 'cash') {
      return errorResponse(corsHeaders, 400, 'INVALID_PAYMENT_METHOD', 'This endpoint handles cash only. Use create-weekly-checkout for online payments.');
    }

    if (days.length > 6) {
      return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', 'Weekly order can have at most 6 days (Mon-Sat)');
    }

    // Validate week_start is a Monday
    const weekStartDate = new Date(week_start + 'T00:00:00');
    if (weekStartDate.getDay() !== 1) {
      return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', 'week_start must be a Monday');
    }

    // Validate each day falls within the target week (Mon-Fri)
    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekEndDate.getDate() + 5); // Saturday (for makeup days)
    const weekEndStr = weekEndDate.toISOString().split('T')[0];

    for (const day of days) {
      if (!day.scheduled_for || !day.items || day.items.length === 0) {
        return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', 'Each day must have scheduled_for and items');
      }
      if (day.scheduled_for < week_start || day.scheduled_for > weekEndStr) {
        return errorResponse(corsHeaders, 400, 'VALIDATION_ERROR', `Date ${day.scheduled_for} is outside the target week (${week_start} to ${weekEndStr})`);
      }
      const dayDate = new Date(day.scheduled_for + 'T00:00:00');
      const dow = dayDate.getDay();
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
    // Default: Friday 17:00 Manila time
    // DB stores lowercase (e.g. "friday"), normalize to title case for dayNames lookup
    const rawCutoffDay = (settings.get('weekly_cutoff_day') as string) || 'Friday';
    const cutoffDay = rawCutoffDay.charAt(0).toUpperCase() + rawCutoffDay.slice(1).toLowerCase();
    const cutoffTime = (settings.get('weekly_cutoff_time') as string) || '17:00';

    const phNow = getPhilippineTime();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDayName = dayNames[phNow.getDay()];
    const currentTimeStr = phNow.toISOString().substring(11, 16);

    // The cutoff day index
    const cutoffDayIndex = dayNames.indexOf(cutoffDay);
    const currentDayIndex = phNow.getDay();

    // Check if we're past the cutoff for this week_start
    // The cutoff applies to ordering for NEXT week. After cutoff, no more orders for next week.
    // We need to ensure the week_start is for the upcoming week relative to now.
    const todayStr = phNow.toISOString().split('T')[0];
    if (week_start <= todayStr) {
      return errorResponse(corsHeaders, 400, 'PAST_WEEK', 'Cannot order for current or past weeks. Weekly orders are for the next school week.');
    }

    // Check if past the cutoff: if current day is after cutoff day, or same day but past cutoff time
    if (currentDayIndex > cutoffDayIndex || (currentDayIndex === cutoffDayIndex && currentTimeStr >= cutoffTime)) {
      // Check if we're trying to order for the immediately next week (which is now past cutoff)
      // Calculate next Monday from today
      const daysUntilNextMonday = (8 - currentDayIndex) % 7 || 7;
      const nextMonday = new Date(phNow);
      nextMonday.setDate(nextMonday.getDate() + daysUntilNextMonday);
      const nextMondayStr = nextMonday.toISOString().split('T')[0];

      if (week_start === nextMondayStr) {
        return errorResponse(corsHeaders, 400, 'PAST_CUTOFF',
          `Weekly order cutoff (${cutoffDay} ${cutoffTime}) has passed. You can no longer order for the week of ${week_start}.`);
      }
    }

    // ── Verify parent-student link ──
    const { data: studentLink, error: linkError } = await supabaseAdmin
      .from('parent_students')
      .select('student_id')
      .eq('student_id', student_id)
      .eq('parent_id', parent_id)
      .single();

    if (linkError || !studentLink) {
      return errorResponse(corsHeaders, 401, 'UNAUTHORIZED', 'Parent is not linked to this student');
    }

    // ── Check for duplicate weekly order ──
    const { data: existingWeekly } = await supabaseAdmin
      .from('weekly_orders')
      .select('id, status')
      .eq('student_id', student_id)
      .eq('week_start', week_start)
      .neq('status', 'cancelled')
      .limit(1)
      .single();

    if (existingWeekly) {
      return errorResponse(corsHeaders, 409, 'DUPLICATE_WEEKLY_ORDER',
        `A weekly order already exists for this student for the week of ${week_start}`,
        { existing_weekly_order_id: existingWeekly.id });
    }

    // ── Validate products (fetch once) ──
    const allProductIds = [...new Set(days.flatMap(d => d.items.map(i => i.product_id)))];
    const { data: products, error: productsError } = await supabaseAdmin
      .from('products')
      .select('id, name, price, available')
      .in('id', allProductIds);

    if (productsError || !products) {
      return errorResponse(corsHeaders, 500, 'SERVER_ERROR', 'Failed to fetch products');
    }

    const productMap = new Map(products.map(p => [p.id, p]));

    // Validate all items
    let weeklyTotal = 0;
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
      }
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

    // ── Validate products against menu schedules ──
    const { data: schedules } = await supabaseAdmin
      .from('menu_schedules')
      .select('product_id, day_of_week')
      .eq('is_active', true)
      .in('product_id', allProductIds);

    const scheduleSet = new Set(
      (schedules || []).map(s => `${s.product_id}_${s.day_of_week}`)
    );

    for (const day of days) {
      const scheduledDate = new Date(day.scheduled_for + 'T00:00:00');
      const dow = scheduledDate.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      for (const item of day.items) {
        const product = productMap.get(item.product_id);
        if (product && !scheduleSet.has(`${item.product_id}_${dow}`)) {
          return errorResponse(corsHeaders, 400, 'NOT_ON_MENU',
            `'${product.name}' is not on the menu for ${day.scheduled_for}`,
            { product_id: item.product_id, scheduled_for: day.scheduled_for });
        }
      }
    }

    console.log('Processing weekly order:', { parent_id, student_id, week_start, days_count: days.length, total: weeklyTotal });

    // ── Create weekly_orders record ──
    const paymentDueAt = new Date(Date.now() + CASH_PAYMENT_TIMEOUT_MINUTES * 60 * 1000).toISOString();

    const { data: weeklyOrder, error: woError } = await supabaseAdmin
      .from('weekly_orders')
      .insert({
        parent_id,
        student_id,
        week_start,
        total_amount: weeklyTotal,
        payment_method: 'cash',
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
        payment_method: 'cash',
        notes: notes || null,
        scheduled_for: day.scheduled_for,
        client_order_id: `WO-${weeklyOrder.id.substring(0, 8)}-${day.scheduled_for}`,
      };
    });

    const { data: createdOrders, error: ordersError } = await supabaseAdmin
      .from('orders')
      .insert(dailyOrderRows)
      .select('id, scheduled_for, total_amount, client_order_id');

    if (ordersError || !createdOrders || createdOrders.length === 0) {
      console.error('Daily orders insert error:', ordersError);
      // Rollback weekly order
      await supabaseAdmin.from('weekly_orders').delete().eq('id', weeklyOrder.id);
      return errorResponse(corsHeaders, 500, 'ORDER_CREATION_FAILED', 'Failed to create daily orders');
    }

    // Map scheduled_for → order.id for linking items
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
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from('payments')
      .insert({
        parent_id,
        type: 'payment',
        amount_total: weeklyTotal,
        method: 'cash',
        status: 'pending',
        weekly_order_id: weeklyOrder.id,
      })
      .select('id')
      .single();

    if (paymentError || !payment) {
      console.error('Payment record insert error:', paymentError);
      // Rollback: delete order items, daily orders, and weekly order
      await supabaseAdmin.from('order_items').delete().in('order_id', createdOrderIds);
      await supabaseAdmin.from('orders').delete().in('id', createdOrderIds);
      await supabaseAdmin.from('weekly_orders').delete().eq('id', weeklyOrder.id);
      return errorResponse(corsHeaders, 500, 'PAYMENT_RECORD_FAILED', 'Failed to create payment record');
    }

    {
      const allocations = createdOrders.map(o => ({
        payment_id: payment.id,
        order_id: o.id,
        allocated_amount: o.total_amount,
      }));
      await supabaseAdmin.from('payment_allocations').insert(allocations);
    }

    console.log('Weekly order created:', {
      weekly_order_id: weeklyOrder.id,
      daily_orders: createdOrderIds.length,
      total: weeklyTotal,
    });

    return new Response(
      JSON.stringify({
        success: true,
        weekly_order_id: weeklyOrder.id,
        order_ids: createdOrderIds,
        orders: createdOrders.map(o => ({
          order_id: o.id,
          scheduled_for: o.scheduled_for,
          total_amount: o.total_amount,
        })),
        total_amount: weeklyTotal,
        payment_due_at: paymentDueAt,
        message: `Weekly order created. Please pay ₱${weeklyTotal.toFixed(2)} at the cashier within ${CASH_PAYMENT_TIMEOUT_MINUTES / 60} hours.`,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Unexpected error:', error);
    return errorResponse(corsHeaders, 500, 'SERVER_ERROR', 'An unexpected error occurred');
  }
});
