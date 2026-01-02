// Update Dietary Edge Function
// Parent-only dietary restrictions update with server-side validation

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UpdateDietaryRequest {
  child_id: string;
  dietary_restrictions: string;
}

function sanitizeString(str: string | undefined, maxLength: number = 500): string {
  if (!str) return '';
  return str.trim().slice(0, maxLength).replace(/[<>]/g, '');
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get auth token from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract token from Bearer header
    const token = authHeader.replace('Bearer ', '');

    // Initialize Supabase client with service role for operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Get user from token using admin client
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      console.log('Auth error:', authError?.message);
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: UpdateDietaryRequest = await req.json();
    const { child_id, dietary_restrictions } = body;

    if (!child_id) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Child ID required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(child_id)) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Invalid child ID format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the child belongs to this parent
    const { data: child, error: findError } = await supabaseAdmin
      .from('children')
      .select('id, parent_id')
      .eq('id', child_id)
      .single();

    if (findError || !child) {
      return new Response(
        JSON.stringify({ error: 'NOT_FOUND', message: 'Child not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // CRITICAL: Only allow updating own children
    if (child.parent_id !== user.id) {
      console.log(`SECURITY: User ${user.id} attempted to update dietary for child ${child_id} belonging to ${child.parent_id}`);
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'You can only update your own children' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Sanitize and update dietary restrictions
    const sanitizedDietary = sanitizeString(dietary_restrictions, 500);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('children')
      .update({ 
        dietary_restrictions: sanitizedDietary || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', child_id)
      .eq('parent_id', user.id) // Extra safety check
      .select('id, student_id, first_name, last_name, grade_level, section, dietary_restrictions')
      .single();

    if (updateError || !updated) {
      console.error('Failed to update dietary:', updateError);
      return new Response(
        JSON.stringify({ error: 'SERVER_ERROR', message: 'Failed to update dietary info' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, child: updated }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Update dietary error:', error);
    return new Response(
      JSON.stringify({ error: 'SERVER_ERROR', message: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
