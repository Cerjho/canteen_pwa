// Manage Menu Edge Function
// Secure server-side menu schedule management
// FIXED: Now uses scheduled_date instead of day_of_week

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Action = 'add' | 'add-bulk' | 'remove' | 'toggle' | 'copy-day' | 'copy-week' | 'clear-day' | 'clear-week';

interface ManageMenuRequest {
  action: Action;
  schedule_id?: string;
  product_id?: string;
  product_ids?: string[];
  scheduled_date?: string; // ISO date string (YYYY-MM-DD) - the specific date
  day_of_week?: number; // 1-5 (Mon-Fri) - for reference only
  from_date?: string; // Source date for copy operations
  to_date?: string; // Target date for copy operations
  week_start?: string; // ISO date string for week operations
  is_active?: boolean;
}

// Helper to add days to a date string
function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00');
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

// Helper to get day of week from date string (1=Mon, 5=Fri)
function getDayOfWeek(dateStr: string): number {
  const date = new Date(dateStr + 'T00:00:00');
  const day = date.getDay();
  return day === 0 ? 7 : day; // Convert Sunday=0 to 7
}

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

    // Check if user is admin
    const userRole = user.user_metadata?.role;
    if (userRole !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: ManageMenuRequest = await req.json();
    const { action, schedule_id, product_id, product_ids, scheduled_date, day_of_week, from_date, to_date, week_start, is_active } = body;

    // Validate action
    const validActions: Action[] = ['add', 'add-bulk', 'remove', 'toggle', 'copy-day', 'copy-week', 'clear-day', 'clear-week'];
    if (!validActions.includes(action)) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: `Invalid action. Must be: ${validActions.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    switch (action) {
      case 'add': {
        if (!product_id || !scheduled_date) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'product_id and scheduled_date are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Verify product exists
        const { data: product, error: productError } = await supabaseAdmin
          .from('products')
          .select('id, name')
          .eq('id', product_id)
          .single();

        if (productError || !product) {
          return new Response(
            JSON.stringify({ error: 'PRODUCT_NOT_FOUND', message: 'Product not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Check if already exists for this date
        const { data: existing } = await supabaseAdmin
          .from('menu_schedules')
          .select('id')
          .eq('product_id', product_id)
          .eq('scheduled_date', scheduled_date)
          .single();

        if (existing) {
          return new Response(
            JSON.stringify({ error: 'ALREADY_EXISTS', message: 'Product already scheduled for this date' }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Calculate day_of_week from scheduled_date
        const calculatedDayOfWeek = day_of_week ?? getDayOfWeek(scheduled_date);

        const { data: newSchedule, error: insertError } = await supabaseAdmin
          .from('menu_schedules')
          .insert({ 
            product_id, 
            scheduled_date,
            day_of_week: calculatedDayOfWeek,
            is_active: true 
          })
          .select()
          .single();

        if (insertError) {
          console.error('Menu add error:', insertError);
          return new Response(
            JSON.stringify({ error: 'INSERT_FAILED', message: 'Failed to add to menu' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] Admin ${user.email} added product ${product.name} to ${scheduled_date}`);

        return new Response(
          JSON.stringify({ success: true, schedule: newSchedule }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'add-bulk': {
        if (!product_ids || product_ids.length === 0 || !scheduled_date) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'product_ids array and scheduled_date are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get existing schedules for this date
        const { data: existing } = await supabaseAdmin
          .from('menu_schedules')
          .select('product_id')
          .eq('scheduled_date', scheduled_date);

        const existingIds = new Set((existing || []).map(e => e.product_id));
        const newProductIds = product_ids.filter(id => !existingIds.has(id));

        if (newProductIds.length === 0) {
          return new Response(
            JSON.stringify({ success: true, added: 0, message: 'All products already scheduled' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Calculate day_of_week from scheduled_date
        const calculatedDayOfWeek = day_of_week ?? getDayOfWeek(scheduled_date);

        const schedules = newProductIds.map(pid => ({
          product_id: pid,
          scheduled_date,
          day_of_week: calculatedDayOfWeek,
          is_active: true
        }));

        const { error: insertError } = await supabaseAdmin
          .from('menu_schedules')
          .insert(schedules);

        if (insertError) {
          console.error('Bulk menu add error:', insertError);
          return new Response(
            JSON.stringify({ error: 'INSERT_FAILED', message: 'Failed to add products to menu' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] Admin ${user.email} bulk added ${newProductIds.length} products to ${scheduled_date}`);

        return new Response(
          JSON.stringify({ success: true, added: newProductIds.length }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'remove': {
        if (!schedule_id) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'schedule_id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error: deleteError } = await supabaseAdmin
          .from('menu_schedules')
          .delete()
          .eq('id', schedule_id);

        if (deleteError) {
          return new Response(
            JSON.stringify({ error: 'DELETE_FAILED', message: 'Failed to remove from menu' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] Admin ${user.email} removed menu schedule ${schedule_id}`);

        return new Response(
          JSON.stringify({ success: true, schedule_id }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'toggle': {
        if (!schedule_id) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'schedule_id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: schedule, error: fetchError } = await supabaseAdmin
          .from('menu_schedules')
          .select('is_active')
          .eq('id', schedule_id)
          .single();

        if (fetchError || !schedule) {
          return new Response(
            JSON.stringify({ error: 'SCHEDULE_NOT_FOUND', message: 'Menu schedule not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const newActive = is_active !== undefined ? is_active : !schedule.is_active;

        const { error: updateError } = await supabaseAdmin
          .from('menu_schedules')
          .update({ is_active: newActive })
          .eq('id', schedule_id);

        if (updateError) {
          return new Response(
            JSON.stringify({ error: 'UPDATE_FAILED', message: 'Failed to toggle menu item' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] Admin ${user.email} toggled menu ${schedule_id} to ${newActive}`);

        return new Response(
          JSON.stringify({ success: true, schedule_id, is_active: newActive }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'copy-day': {
        if (!from_date || !to_date) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'from_date and to_date are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get source menu
        const { data: sourceMenu } = await supabaseAdmin
          .from('menu_schedules')
          .select('product_id, is_active')
          .eq('scheduled_date', from_date);

        if (!sourceMenu || sourceMenu.length === 0) {
          return new Response(
            JSON.stringify({ error: 'NO_SOURCE_MENU', message: 'No menu items on source date' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Clear target date
        await supabaseAdmin
          .from('menu_schedules')
          .delete()
          .eq('scheduled_date', to_date);

        // Calculate day_of_week for target date
        const toDayOfWeek = getDayOfWeek(to_date);

        // Copy items
        const newItems = sourceMenu.map(item => ({
          product_id: item.product_id,
          scheduled_date: to_date,
          day_of_week: toDayOfWeek,
          is_active: item.is_active
        }));

        const { error: insertError } = await supabaseAdmin
          .from('menu_schedules')
          .insert(newItems);

        if (insertError) {
          return new Response(
            JSON.stringify({ error: 'COPY_FAILED', message: 'Failed to copy menu' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] Admin ${user.email} copied menu from ${from_date} to ${to_date} (${sourceMenu.length} items)`);

        return new Response(
          JSON.stringify({ success: true, copied: sourceMenu.length, from_date, to_date }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'copy-week': {
        if (!from_date || !week_start) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'from_date and week_start are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get source menu
        const { data: sourceMenu } = await supabaseAdmin
          .from('menu_schedules')
          .select('product_id, is_active')
          .eq('scheduled_date', from_date);

        if (!sourceMenu || sourceMenu.length === 0) {
          return new Response(
            JSON.stringify({ error: 'NO_SOURCE_MENU', message: 'No menu items on source date' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Copy to all weekdays (Mon-Fri) of the week
        const targetDates: string[] = [];
        for (let i = 0; i < 5; i++) {
          const targetDate = addDays(week_start, i);
          if (targetDate !== from_date) {
            targetDates.push(targetDate);
          }
        }

        for (const targetDate of targetDates) {
          // Clear target date
          await supabaseAdmin
            .from('menu_schedules')
            .delete()
            .eq('scheduled_date', targetDate);

          // Calculate day_of_week
          const targetDayOfWeek = getDayOfWeek(targetDate);

          const newItems = sourceMenu.map(item => ({
            product_id: item.product_id,
            scheduled_date: targetDate,
            day_of_week: targetDayOfWeek,
            is_active: item.is_active
          }));

          await supabaseAdmin.from('menu_schedules').insert(newItems);
        }

        console.log(`[AUDIT] Admin ${user.email} copied menu from ${from_date} to all weekdays (${sourceMenu.length} items)`);

        return new Response(
          JSON.stringify({ success: true, copied_to_dates: targetDates, items_per_day: sourceMenu.length }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'clear-day': {
        if (!scheduled_date) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'scheduled_date is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: deleted, error: deleteError } = await supabaseAdmin
          .from('menu_schedules')
          .delete()
          .eq('scheduled_date', scheduled_date)
          .select('id');

        if (deleteError) {
          return new Response(
            JSON.stringify({ error: 'DELETE_FAILED', message: 'Failed to clear day' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] Admin ${user.email} cleared menu for ${scheduled_date}`);

        return new Response(
          JSON.stringify({ success: true, scheduled_date, cleared: deleted?.length || 0 }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'clear-week': {
        if (!week_start) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'week_start is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Calculate week end (Friday)
        const weekEnd = addDays(week_start, 4);

        const { data: deleted, error: deleteError } = await supabaseAdmin
          .from('menu_schedules')
          .delete()
          .gte('scheduled_date', week_start)
          .lte('scheduled_date', weekEnd)
          .select('id');

        if (deleteError) {
          return new Response(
            JSON.stringify({ error: 'DELETE_FAILED', message: 'Failed to clear week' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] Admin ${user.email} cleared week menu (${week_start} to ${weekEnd})`);

        return new Response(
          JSON.stringify({ success: true, week_start, week_end: weekEnd, cleared: deleted?.length || 0 }),
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
