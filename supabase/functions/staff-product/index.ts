// Staff Product Edge Function
// Allows staff to manage product availability and stock (limited operations)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPrefllight } from '../_shared/cors.ts';

type Action = 'toggle-availability' | 'update-stock' | 'mark-all-available';

interface StaffProductRequest {
  action: Action;
  product_id?: string;
  available?: boolean;
  stock_quantity?: number;
}

// Validation constants
const MAX_STOCK = 99999;

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

    // Check if user is staff or admin
    const userRole = user.app_metadata?.role;
    if (!['staff', 'admin'].includes(userRole)) {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Staff or admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: StaffProductRequest = await req.json();
    const { action, product_id, available, stock_quantity } = body;

    // Validate action
    const validActions: Action[] = ['toggle-availability', 'update-stock', 'mark-all-available'];
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

      case 'update-stock': {
        if (!product_id) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'product_id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (typeof stock_quantity !== 'number' || stock_quantity < 0 || stock_quantity > MAX_STOCK) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: `stock_quantity must be between 0 and ${MAX_STOCK}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Verify product exists
        const { data: product, error: fetchError } = await supabaseAdmin
          .from('products')
          .select('id, name, stock_quantity')
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
            stock_quantity, 
            updated_at: new Date().toISOString() 
          })
          .eq('id', product_id);

        if (updateError) {
          console.error('Update stock error:', updateError);
          return new Response(
            JSON.stringify({ error: 'UPDATE_FAILED', message: 'Failed to update stock' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] ${userRole} ${user.email} updated stock for ${product.name}: ${product.stock_quantity} -> ${stock_quantity}`);

        return new Response(
          JSON.stringify({ 
            success: true, 
            product_id, 
            previous_stock: product.stock_quantity,
            new_stock: stock_quantity,
            message: 'Stock updated successfully'
          }),
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
