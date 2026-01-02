import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders, handleCorsPrefllight, jsonResponse, errorResponse } from '../_shared/cors.ts';

serve(async (req) => {
  const origin = req.headers.get('Origin');
  
  // Handle CORS preflight
  const preflightResponse = handleCorsPrefllight(req);
  if (preflightResponse) return preflightResponse;

  try {
    // Verify the requesting user is an admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return errorResponse('Missing authorization header', 401, origin);
    }

    // Extract token from Bearer header
    const token = authHeader.replace('Bearer ', '');

    // Create Supabase client with service role for admin operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Get user from token using admin client
    const { data: { user: requestingUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !requestingUser) {
      return errorResponse('Unauthorized', 401, origin);
    }

    if (requestingUser.user_metadata?.role !== 'admin') {
      return errorResponse('Only admins can list staff', 403, origin);
    }

    // Parse pagination parameters from request body or query
    let page = 1;
    let perPage = 50;
    try {
      if (req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        page = Math.max(1, parseInt(body.page) || 1);
        perPage = Math.min(100, Math.max(1, parseInt(body.per_page) || 50));
      }
    } catch {
      // Use defaults if parsing fails
    }

    // List users with pagination
    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage
    });
    
    if (listError) {
      return errorResponse(listError.message, 400, origin);
    }

    // Filter staff and admin users
    const staffMembers = users
      .filter(user => 
        user.user_metadata?.role === 'staff' || 
        user.user_metadata?.role === 'admin'
      )
      .map(user => ({
        id: user.id,
        email: user.email,
        first_name: user.user_metadata?.first_name || '',
        last_name: user.user_metadata?.last_name || '',
        role: user.user_metadata?.role,
        created_at: user.created_at,
      }));

    return jsonResponse(
      { 
        staff: staffMembers,
        pagination: { page, perPage, hasMore: users.length === perPage }
      },
      200,
      origin
    );

  } catch (error) {
    console.error('Error in list-staff function:', error);
    return errorResponse('Internal server error', 500, origin);
  }
});
