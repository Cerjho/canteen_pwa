// Manage Menu Edge Function
// Secure server-side menu schedule management
// FIXED: Now uses scheduled_date instead of day_of_week

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPrefllight } from '../_shared/cors.ts';

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

// Helper to add days to a date string (timezone-safe)
function addDays(dateStr: string, days: number): string {
  // Parse as UTC to avoid timezone issues
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
}

// Helper to get day of week from date string (1=Mon, 5=Fri) - timezone-safe
function getDayOfWeek(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = date.getUTCDay();
  return dayOfWeek === 0 ? 7 : dayOfWeek; // Convert Sunday=0 to 7
}

// Helper to check if a date is a holiday
async function isHoliday(supabaseAdmin: ReturnType<typeof createClient>, dateStr: string): Promise<{ isHoliday: boolean; holidayName?: string }> {
  const monthDay = dateStr.slice(5); // MM-DD for recurring check
  
  // Check for exact date match or recurring holiday
  const { data: holidays } = await supabaseAdmin
    .from('holidays')
    .select('name, date, is_recurring');
  
  if (!holidays || holidays.length === 0) {
    return { isHoliday: false };
  }
  
  const holiday = holidays.find(h => {
    const holidayDateStr = h.date.split('T')[0];
    const holidayMonthDay = holidayDateStr.slice(5);
    
    if (h.is_recurring) {
      return holidayMonthDay === monthDay;
    }
    return holidayDateStr === dateStr;
  });
  
  if (holiday) {
    return { isHoliday: true, holidayName: holiday.name };
  }
  
  return { isHoliday: false };
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  const preflightResponse = handleCorsPrefllight(req);
  if (preflightResponse) return preflightResponse;

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
    const userRole = user.app_metadata?.role;
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

        // Check if date is a holiday
        const holidayCheck = await isHoliday(supabaseAdmin, scheduled_date);
        if (holidayCheck.isHoliday) {
          return new Response(
            JSON.stringify({ error: 'HOLIDAY_DATE', message: `Cannot add menu items on a holiday (${holidayCheck.holidayName})` }),
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
        const rawDayOfWeek = day_of_week ?? getDayOfWeek(scheduled_date);
        // Clamp to 1-5 for DB CHECK constraint; weekend makeup days store as nearest weekday
        const calculatedDayOfWeek = Math.min(rawDayOfWeek, 5);

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

        // Check if date is a holiday
        const bulkHolidayCheck = await isHoliday(supabaseAdmin, scheduled_date);
        if (bulkHolidayCheck.isHoliday) {
          return new Response(
            JSON.stringify({ error: 'HOLIDAY_DATE', message: `Cannot add menu items on a holiday (${bulkHolidayCheck.holidayName})` }),
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
        const rawDayOfWeek = day_of_week ?? getDayOfWeek(scheduled_date);
        // Clamp to 1-5 for DB CHECK constraint; weekend makeup days store as nearest weekday
        const calculatedDayOfWeek = Math.min(rawDayOfWeek, 5);

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

        // Check if target date is a holiday
        const copyHolidayCheck = await isHoliday(supabaseAdmin, to_date);
        if (copyHolidayCheck.isHoliday) {
          return new Response(
            JSON.stringify({ error: 'HOLIDAY_DATE', message: `Cannot copy menu to a holiday (${copyHolidayCheck.holidayName})` }),
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

        // Check existing items on target date
        const { data: existingTargetMenu } = await supabaseAdmin
          .from('menu_schedules')
          .select('id')
          .eq('scheduled_date', to_date);

        const replacedCount = existingTargetMenu?.length || 0;

        // Clear target date
        await supabaseAdmin
          .from('menu_schedules')
          .delete()
          .eq('scheduled_date', to_date);

        // Calculate day_of_week for target date (clamp to 1-5 for DB constraint)
        const toDayOfWeek = Math.min(getDayOfWeek(to_date), 5);

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

        console.log(`[AUDIT] Admin ${user.email} copied menu from ${from_date} to ${to_date} (${sourceMenu.length} items, replaced ${replacedCount})`);

        return new Response(
          JSON.stringify({ success: true, copied: sourceMenu.length, replaced: replacedCount, from_date, to_date }),
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

        console.log(`[DEBUG copy-week] Starting copy from ${from_date}, week_start: ${week_start}`);

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

        // Fetch all holidays once for efficiency
        const { data: allHolidays } = await supabaseAdmin
          .from('holidays')
          .select('name, date, is_recurring');
        
        console.log(`[DEBUG copy-week] Found ${allHolidays?.length || 0} holidays in database`);
        if (allHolidays && allHolidays.length > 0) {
          console.log(`[DEBUG copy-week] Holidays: ${JSON.stringify(allHolidays.map(h => ({ name: h.name, date: h.date, is_recurring: h.is_recurring })))}`);
        }

        // Copy to all weekdays (Mon-Fri) of the week, skipping holidays
        const targetDates: string[] = [];
        const skippedHolidays: string[] = [];
        
        for (let i = 0; i < 5; i++) {
          const targetDate = addDays(week_start, i);
          const targetMonthDay = targetDate.slice(5); // MM-DD
          console.log(`[DEBUG copy-week] Day ${i}: targetDate=${targetDate}, targetMonthDay=${targetMonthDay}`);
          
          if (targetDate !== from_date) {
            // Check if target date is a holiday (inline check for better debugging)
            
            const matchedHoliday = allHolidays?.find(h => {
              const holidayDateStr = h.date.split('T')[0];
              const holidayMonthDay = holidayDateStr.slice(5);
              
              console.log(`[DEBUG copy-week] Comparing with holiday: ${h.name}, holidayDateStr=${holidayDateStr}, holidayMonthDay=${holidayMonthDay}, is_recurring=${h.is_recurring}`);
              
              if (h.is_recurring) {
                const match = holidayMonthDay === targetMonthDay;
                console.log(`[DEBUG copy-week] Recurring check: ${holidayMonthDay} === ${targetMonthDay} ? ${match}`);
                return match;
              }
              const match = holidayDateStr === targetDate;
              console.log(`[DEBUG copy-week] Exact check: ${holidayDateStr} === ${targetDate} ? ${match}`);
              return match;
            });
            
            if (matchedHoliday) {
              console.log(`[DEBUG copy-week] SKIPPING ${targetDate} - holiday: ${matchedHoliday.name}`);
              skippedHolidays.push(`${targetDate} (${matchedHoliday.name})`);
            } else {
              console.log(`[DEBUG copy-week] COPYING to ${targetDate}`);
              targetDates.push(targetDate);
            }
          } else {
            console.log(`[DEBUG copy-week] Skipping source date: ${targetDate}`);
          }
        }

        for (const targetDate of targetDates) {
          // Clear target date
          await supabaseAdmin
            .from('menu_schedules')
            .delete()
            .eq('scheduled_date', targetDate);

          // Calculate day_of_week (clamp to 1-5 for DB constraint)
          const targetDayOfWeek = Math.min(getDayOfWeek(targetDate), 5);

          const newItems = sourceMenu.map(item => ({
            product_id: item.product_id,
            scheduled_date: targetDate,
            day_of_week: targetDayOfWeek,
            is_active: item.is_active
          }));

          await supabaseAdmin.from('menu_schedules').insert(newItems);
        }

        console.log(`[AUDIT] Admin ${user.email} copied menu from ${from_date} to all weekdays (${sourceMenu.length} items, skipped holidays: ${skippedHolidays.join(', ') || 'none'})`);

        return new Response(
          JSON.stringify({ 
            success: true, 
            copied_to_dates: targetDates, 
            items_per_day: sourceMenu.length,
            skipped_holidays: skippedHolidays
          }),
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
