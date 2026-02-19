import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCorsPrefllight, jsonResponse, errorResponse } from '../_shared/cors.ts';

// Generate a short, readable invite code
function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars like 0/O, 1/I
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

interface InviteRequest {
  emails: string[];
  role: 'parent' | 'staff' | 'admin';
}

serve(async (req) => {
  const origin = req.headers.get('Origin');

  // Handle CORS preflight
  const preflightResponse = handleCorsPrefllight(req);
  if (preflightResponse) return preflightResponse;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return errorResponse('Missing authorization header', 401, origin);
    }

    // Extract token from Bearer header
    const token = authHeader.replace('Bearer ', '');

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

    if (requestingUser.app_metadata?.role !== 'admin') {
      return errorResponse('Only admins can send invitations', 403, origin);
    }

    const { emails, role = 'parent' }: InviteRequest = await req.json();

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return errorResponse('At least one email is required', 400, origin);
    }

    if (!['parent', 'staff', 'admin'].includes(role)) {
      return errorResponse('Invalid role', 400, origin);
    }

    const results: { email: string; success: boolean; code?: string; error?: string }[] = [];
    const siteUrl = Deno.env.get('SITE_URL') || 'http://localhost:5173';

    for (const email of emails) {
      const trimmedEmail = email.trim().toLowerCase();
      
      if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        results.push({ email: trimmedEmail, success: false, error: 'Invalid email format' });
        continue;
      }

      // Check if email already has an account (use search instead of listing all users)
      // Note: listUsers with filter is more efficient than fetching all users
      let existingUser = null;
      let page = 1;
      const perPage = 100;
      
      // Search for user by email using pagination to avoid loading all users
      while (true) {
        const { data: usersPage } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
        if (!usersPage?.users || usersPage.users.length === 0) break;
        
        existingUser = usersPage.users.find(u => u.email === trimmedEmail);
        if (existingUser) break;
        
        // If we got fewer users than requested, we've reached the end
        if (usersPage.users.length < perPage) break;
        page++;
        
        // Safety limit to prevent infinite loop
        if (page > 100) break;
      }
      
      if (existingUser) {
        results.push({ email: trimmedEmail, success: false, error: 'Email already registered' });
        continue;
      }

      // Check if there's already a pending invitation
      const { data: existingInvite } = await supabaseAdmin
        .from('invitations')
        .select('code')
        .eq('email', trimmedEmail)
        .eq('used', false)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (existingInvite) {
        // Return existing invite code
        results.push({ 
          email: trimmedEmail, 
          success: true, 
          code: existingInvite.code,
          error: 'Existing invitation' 
        });
        continue;
      }

      // Generate unique code
      let code: string;
      let attempts = 0;
      do {
        code = generateInviteCode();
        const { data: existing } = await supabaseAdmin
          .from('invitations')
          .select('id')
          .eq('code', code)
          .single();
        if (!existing) break;
        attempts++;
      } while (attempts < 10);

      // Create invitation
      const { error: insertError } = await supabaseAdmin
        .from('invitations')
        .insert({
          email: trimmedEmail,
          code,
          role,
          created_by: requestingUser.id,
        });

      if (insertError) {
        results.push({ email: trimmedEmail, success: false, error: insertError.message });
      } else {
        results.push({ email: trimmedEmail, success: true, code });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    // Generate registration URL
    const registrationBaseUrl = `${siteUrl}/register`;

    return jsonResponse(
      { 
        success: successCount > 0,
        message: `${successCount} invitation(s) created${failCount > 0 ? `, ${failCount} failed` : ''}`,
        registrationUrl: registrationBaseUrl,
        results,
        summary: { total: emails.length, success: successCount, failed: failCount }
      },
      200,
      origin
    );

  } catch (error) {
    console.error('Error in send-invites function:', error);
    return errorResponse('Internal server error', 500, origin);
  }
});
