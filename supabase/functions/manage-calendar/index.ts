// Manage Calendar Edge Function
// Secure server-side holiday and makeup day management

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPrefllight } from '../_shared/cors.ts';

type Action = 
  | 'add-holiday' 
  | 'remove-holiday' 
  | 'add-makeup' 
  | 'remove-makeup'
  | 'list-holidays'
  | 'list-makeup';

interface ManageCalendarRequest {
  action: Action;
  id?: string;
  date?: string; // ISO date string YYYY-MM-DD
  name?: string;
  description?: string;
  is_recurring?: boolean;
  reason?: string;
  acts_as_day?: number; // 0-6, what day of week the makeup day acts as
  year?: number;
  month?: number;
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

    const body: ManageCalendarRequest = await req.json();
    const { action, id, date, name, description, is_recurring, reason, acts_as_day, year, month } = body;

    // Validate action
    const validActions: Action[] = ['add-holiday', 'remove-holiday', 'add-makeup', 'remove-makeup', 'list-holidays', 'list-makeup'];
    if (!validActions.includes(action)) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: `Invalid action. Must be: ${validActions.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Date validation helper
    const isValidDate = (dateStr: string): boolean => {
      const regex = /^\d{4}-\d{2}-\d{2}$/;
      if (!regex.test(dateStr)) return false;
      const d = new Date(dateStr);
      return !isNaN(d.getTime());
    };

    // Don't allow past dates
    const isPastDate = (dateStr: string): boolean => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const checkDate = new Date(dateStr);
      return checkDate < today;
    };

    // Don't allow dates too far in future (2 years)
    const isTooFarFuture = (dateStr: string): boolean => {
      const maxDate = new Date();
      maxDate.setFullYear(maxDate.getFullYear() + 2);
      const checkDate = new Date(dateStr);
      return checkDate > maxDate;
    };

    switch (action) {
      case 'add-holiday': {
        if (!date) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'date is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!isValidDate(date)) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Invalid date format. Use YYYY-MM-DD' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (isPastDate(date)) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Cannot add holiday for past date' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (isTooFarFuture(date)) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Date too far in future (max 2 years)' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Sanitize description
        const sanitizedDescription = description?.trim().slice(0, 255) || null;

        // Check if already exists
        const { data: existing } = await supabaseAdmin
          .from('holidays')
          .select('id')
          .eq('date', date)
          .single();

        if (existing) {
          return new Response(
            JSON.stringify({ error: 'ALREADY_EXISTS', message: 'Holiday already exists for this date' }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: newHoliday, error: insertError } = await supabaseAdmin
          .from('holidays')
          .insert({
            name: sanitizedName,
            date,
            description: sanitizedDescription,
            is_recurring: is_recurring || false,
            created_by: user.id
          })
          .select()
          .single();

        if (insertError) {
          console.error('Holiday add error:', insertError);
          return new Response(
            JSON.stringify({ error: 'INSERT_FAILED', message: 'Failed to add holiday' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] Admin ${user.email} added holiday on ${date}: ${sanitizedDescription}`);

        return new Response(
          JSON.stringify({ success: true, holiday: newHoliday }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'remove-holiday': {
        if (!id && !date) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'id or date is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        let query = supabaseAdmin.from('holidays').delete();
        
        if (id) {
          query = query.eq('id', id);
        } else if (date) {
          query = query.eq('date', date);
        }

        const { error: deleteError } = await query;

        if (deleteError) {
          return new Response(
            JSON.stringify({ error: 'DELETE_FAILED', message: 'Failed to remove holiday' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] Admin ${user.email} removed holiday ${id || date}`);

        return new Response(
          JSON.stringify({ success: true, removed: id || date }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'add-makeup': {
        if (!date || acts_as_day === undefined) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'date and acts_as_day are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!isValidDate(date)) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Invalid date format. Use YYYY-MM-DD' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (acts_as_day < 0 || acts_as_day > 6) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'acts_as_day must be 0-6 (Sunday-Saturday)' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (isPastDate(date)) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Cannot add makeup day for past date' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (isTooFarFuture(date)) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Date too far in future (max 2 years)' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Sanitize name and reason
        const sanitizedMakeupName = (name || 'Make-up Class').trim().slice(0, 100);
        const sanitizedReason = (reason || description)?.trim().slice(0, 255) || null;

        // Check if already exists
        const { data: existing } = await supabaseAdmin
          .from('makeup_days')
          .select('id')
          .eq('date', date)
          .single();

        if (existing) {
          return new Response(
            JSON.stringify({ error: 'ALREADY_EXISTS', message: 'Makeup day already exists for this date' }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: newMakeup, error: insertError } = await supabaseAdmin
          .from('makeup_days')
          .insert({
            date,
            name: sanitizedMakeupName,
            reason: sanitizedReason,
            created_by: user.id
          })
          .select()
          .single();

        if (insertError) {
          console.error('Makeup day add error:', insertError);
          return new Response(
            JSON.stringify({ error: 'INSERT_FAILED', message: 'Failed to add makeup day' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        console.log(`[AUDIT] Admin ${user.email} added makeup day on ${date} acting as ${dayNames[acts_as_day]}`);

        return new Response(
          JSON.stringify({ success: true, makeup: newMakeup }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'remove-makeup': {
        if (!id && !date) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'id or date is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        let query = supabaseAdmin.from('makeup_days').delete();
        
        if (id) {
          query = query.eq('id', id);
        } else if (date) {
          query = query.eq('date', date);
        }

        const { error: deleteError } = await query;

        if (deleteError) {
          return new Response(
            JSON.stringify({ error: 'DELETE_FAILED', message: 'Failed to remove makeup day' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] Admin ${user.email} removed makeup day ${id || date}`);

        return new Response(
          JSON.stringify({ success: true, removed: id || date }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'list-holidays': {
        let query = supabaseAdmin.from('holidays').select('*').order('date', { ascending: true });
        
        if (year) {
          const startDate = `${year}-01-01`;
          const endDate = `${year}-12-31`;
          query = query.gte('date', startDate).lte('date', endDate);
        }
        
        if (month && year) {
          const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
          const lastDay = new Date(year, month, 0).getDate();
          const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
          query = query.gte('date', startDate).lte('date', endDate);
        }

        const { data: holidays, error } = await query;

        if (error) {
          return new Response(
            JSON.stringify({ error: 'FETCH_FAILED', message: 'Failed to fetch holidays' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, holidays }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'list-makeup': {
        let query = supabaseAdmin.from('makeup_days').select('*').order('date', { ascending: true });
        
        if (year) {
          const startDate = `${year}-01-01`;
          const endDate = `${year}-12-31`;
          query = query.gte('date', startDate).lte('date', endDate);
        }
        
        if (month && year) {
          const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
          const lastDay = new Date(year, month, 0).getDate();
          const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
          query = query.gte('date', startDate).lte('date', endDate);
        }

        const { data: makeupDays, error } = await query;

        if (error) {
          return new Response(
            JSON.stringify({ error: 'FETCH_FAILED', message: 'Failed to fetch makeup days' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, makeupDays }),
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
