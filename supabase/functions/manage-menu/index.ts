// Manage Menu Edge Function
// Secure server-side menu schedule management

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Action = 'add' | 'add-bulk' | 'remove' | 'toggle' | 'copy-day' | 'copy-all' | 'clear-day' | 'clear-week';

interface ManageMenuRequest {
  action: Action;
  schedule_id?: string;
  product_id?: string;
  product_ids?: string[];
  day_of_week?: number; // 0-6, Sunday-Saturday
  from_day?: number;
  to_day?: number;
  week_start?: string; // ISO date string
  is_active?: boolean;
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
    const { action, schedule_id, product_id, product_ids, day_of_week, from_day, to_day, week_start, is_active } = body;

    // Validate action
    const validActions: Action[] = ['add', 'add-bulk', 'remove', 'toggle', 'copy-day', 'copy-all', 'clear-day', 'clear-week'];
    if (!validActions.includes(action)) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: `Invalid action. Must be: ${validActions.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    switch (action) {
      case 'add': {
        if (!product_id || day_of_week === undefined) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'product_id and day_of_week are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (day_of_week < 0 || day_of_week > 6) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'day_of_week must be 0-6' }),
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

        // Check if already exists
        const { data: existing } = await supabaseAdmin
          .from('menu_schedules')
          .select('id')
          .eq('product_id', product_id)
          .eq('day_of_week', day_of_week)
          .single();

        if (existing) {
          return new Response(
            JSON.stringify({ error: 'ALREADY_EXISTS', message: 'Product already scheduled for this day' }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: newSchedule, error: insertError } = await supabaseAdmin
          .from('menu_schedules')
          .insert({ product_id, day_of_week, is_active: true })
          .select()
          .single();

        if (insertError) {
          console.error('Menu add error:', insertError);
          return new Response(
            JSON.stringify({ error: 'INSERT_FAILED', message: 'Failed to add to menu' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] Admin ${user.email} added product ${product.name} to day ${day_of_week}`);

        return new Response(
          JSON.stringify({ success: true, schedule: newSchedule }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'add-bulk': {
        if (!product_ids || product_ids.length === 0 || day_of_week === undefined) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'product_ids array and day_of_week are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get existing schedules for this day
        const { data: existing } = await supabaseAdmin
          .from('menu_schedules')
          .select('product_id')
          .eq('day_of_week', day_of_week);

        const existingIds = new Set((existing || []).map(e => e.product_id));
        const newProductIds = product_ids.filter(id => !existingIds.has(id));

        if (newProductIds.length === 0) {
          return new Response(
            JSON.stringify({ success: true, added: 0, message: 'All products already scheduled' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const schedules = newProductIds.map(pid => ({
          product_id: pid,
          day_of_week,
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

        console.log(`[AUDIT] Admin ${user.email} bulk added ${newProductIds.length} products to day ${day_of_week}`);

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
        if (from_day === undefined || to_day === undefined) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'from_day and to_day are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get source menu
        const { data: sourceMenu } = await supabaseAdmin
          .from('menu_schedules')
          .select('product_id, is_active')
          .eq('day_of_week', from_day);

        if (!sourceMenu || sourceMenu.length === 0) {
          return new Response(
            JSON.stringify({ error: 'NO_SOURCE_MENU', message: 'No menu items on source day' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Clear target day
        await supabaseAdmin
          .from('menu_schedules')
          .delete()
          .eq('day_of_week', to_day);

        // Copy items
        const newItems = sourceMenu.map(item => ({
          product_id: item.product_id,
          day_of_week: to_day,
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

        console.log(`[AUDIT] Admin ${user.email} copied menu from day ${from_day} to day ${to_day} (${sourceMenu.length} items)`);

        return new Response(
          JSON.stringify({ success: true, copied: sourceMenu.length, from_day, to_day }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'copy-all': {
        if (from_day === undefined) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'from_day is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get source menu
        const { data: sourceMenu } = await supabaseAdmin
          .from('menu_schedules')
          .select('product_id, is_active')
          .eq('day_of_week', from_day);

        if (!sourceMenu || sourceMenu.length === 0) {
          return new Response(
            JSON.stringify({ error: 'NO_SOURCE_MENU', message: 'No menu items on source day' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Copy to all other weekdays (1-5, Mon-Fri)
        const targetDays = [1, 2, 3, 4, 5].filter(d => d !== from_day);

        for (const targetDay of targetDays) {
          await supabaseAdmin
            .from('menu_schedules')
            .delete()
            .eq('day_of_week', targetDay);

          const newItems = sourceMenu.map(item => ({
            product_id: item.product_id,
            day_of_week: targetDay,
            is_active: item.is_active
          }));

          await supabaseAdmin.from('menu_schedules').insert(newItems);
        }

        console.log(`[AUDIT] Admin ${user.email} copied menu from day ${from_day} to all weekdays (${sourceMenu.length} items)`);

        return new Response(
          JSON.stringify({ success: true, copied_to_days: targetDays, items_per_day: sourceMenu.length }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'clear-day': {
        if (day_of_week === undefined) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'day_of_week is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { count } = await supabaseAdmin
          .from('menu_schedules')
          .delete()
          .eq('day_of_week', day_of_week)
          .select('*', { count: 'exact', head: true });

        console.log(`[AUDIT] Admin ${user.email} cleared menu for day ${day_of_week}`);

        return new Response(
          JSON.stringify({ success: true, day_of_week, cleared: count || 0 }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'clear-week': {
        const { count } = await supabaseAdmin
          .from('menu_schedules')
          .delete()
          .gte('day_of_week', 0)
          .lte('day_of_week', 6)
          .select('*', { count: 'exact', head: true });

        console.log(`[AUDIT] Admin ${user.email} cleared entire week menu`);

        return new Response(
          JSON.stringify({ success: true, cleared: count || 0 }),
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
