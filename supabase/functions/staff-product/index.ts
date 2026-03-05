// Staff Product Edge Function
// Allows staff to manage product availability and surplus items (limited operations)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';

type Action = 'toggle-availability' | 'mark-all-available' | 'mark-surplus' | 'remove-surplus';

interface StaffProductRequest {
  action: Action;
  product_id?: string;
  available?: boolean;
  scheduled_date?: string; // YYYY-MM-DD for surplus
  meal_period?: string;    // 'AM' | 'PM' for surplus
  quantity?: number;       // surplus quantity
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  const preflightResponse = handleCorsPreflight(req);
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

    // Check if user is staff or admin
    const userRole = user.app_metadata?.role;
    if (!['staff', 'admin'].includes(userRole)) {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Staff or admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: StaffProductRequest = await req.json();
    const { action, product_id, available, scheduled_date, meal_period, quantity } = body;

    // Validate action
    const validActions: Action[] = ['toggle-availability', 'mark-all-available', 'mark-surplus', 'remove-surplus'];
    if (!validActions.includes(action)) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: `Invalid action. Must be: ${validActions.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    switch (action) {
      case 'toggle-availability': {
        if (!product_id) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'product_id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (typeof available !== 'boolean') {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'available must be a boolean' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Verify product exists
        const { data: product, error: fetchError } = await supabaseAdmin
          .from('products')
          .select('id, name')
          .eq('id', product_id)
          .single();

        if (fetchError || !product) {
          return new Response(
            JSON.stringify({ error: 'PRODUCT_NOT_FOUND', message: 'Product not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error: updateError } = await supabaseAdmin
          .from('products')
          .update({ 
            available, 
            updated_at: new Date().toISOString() 
          })
          .eq('id', product_id);

        if (updateError) {
          console.error('Toggle availability error:', updateError);
          return new Response(
            JSON.stringify({ error: 'UPDATE_FAILED', message: 'Failed to update availability' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] ${userRole} ${user.email} set product ${product.name} availability to ${available}`);

        return new Response(
          JSON.stringify({ 
            success: true, 
            product_id, 
            available,
            message: available ? 'Product marked as available' : 'Product marked as unavailable'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'mark-surplus': {
        if (!product_id || !scheduled_date) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'product_id and scheduled_date are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduled_date)) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'scheduled_date must be YYYY-MM-DD' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const surplusMeal = meal_period || 'AM';
        if (!['AM', 'PM'].includes(surplusMeal)) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'meal_period must be AM or PM' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const surplusQty = quantity ?? 1;
        if (surplusQty < 1 || surplusQty > 9999) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'quantity must be between 1 and 9999' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Verify product exists
        const { data: surplusProduct, error: spError } = await supabaseAdmin
          .from('products')
          .select('id, name, price')
          .eq('id', product_id)
          .single();

        if (spError || !surplusProduct) {
          return new Response(
            JSON.stringify({ error: 'PRODUCT_NOT_FOUND', message: 'Product not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Upsert into surplus_items
        const { data: surplus, error: surplusError } = await supabaseAdmin
          .from('surplus_items')
          .upsert({
            product_id,
            scheduled_date,
            meal_period: surplusMeal,
            quantity_available: surplusQty,
            original_price: surplusProduct.price,
            marked_by: user.id,
          }, { onConflict: 'product_id,scheduled_date,meal_period' })
          .select()
          .single();

        if (surplusError) {
          console.error('Mark surplus error:', surplusError);
          return new Response(
            JSON.stringify({ error: 'SURPLUS_FAILED', message: 'Failed to mark surplus item' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] ${userRole} ${user.email} marked surplus: ${surplusProduct.name} x${surplusQty} for ${scheduled_date} ${surplusMeal}`);

        return new Response(
          JSON.stringify({ success: true, surplus_item: surplus }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'remove-surplus': {
        if (!product_id || !scheduled_date) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'product_id and scheduled_date are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const removeMeal = meal_period || 'AM';

        const { error: deleteError } = await supabaseAdmin
          .from('surplus_items')
          .delete()
          .eq('product_id', product_id)
          .eq('scheduled_date', scheduled_date)
          .eq('meal_period', removeMeal);

        if (deleteError) {
          console.error('Remove surplus error:', deleteError);
          return new Response(
            JSON.stringify({ error: 'DELETE_FAILED', message: 'Failed to remove surplus item' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] ${userRole} ${user.email} removed surplus: ${product_id} for ${scheduled_date} ${removeMeal}`);

        return new Response(
          JSON.stringify({ success: true, message: 'Surplus item removed' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'mark-all-available': {
        // Mark all unavailable products as available
        const { data: updated, error: updateError } = await supabaseAdmin
          .from('products')
          .update({ 
            available: true, 
            updated_at: new Date().toISOString() 
          })
          .eq('available', false)
          .select('id');

        if (updateError) {
          console.error('Mark all available error:', updateError);
          return new Response(
            JSON.stringify({ error: 'UPDATE_FAILED', message: 'Failed to mark products as available' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const count = updated?.length || 0;
        console.log(`[AUDIT] ${userRole} ${user.email} marked ${count} products as available`);

        return new Response(
          JSON.stringify({ 
            success: true, 
            updated_count: count,
            message: count > 0 ? `${count} products marked as available` : 'No unavailable products found'
          }),
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
