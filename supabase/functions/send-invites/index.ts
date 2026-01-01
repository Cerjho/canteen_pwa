import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: requestingUser }, error: authError } = await supabaseClient.auth.getUser();
    
    if (authError || !requestingUser) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (requestingUser.user_metadata?.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Only admins can send invitations' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { emails, role = 'parent' }: InviteRequest = await req.json();

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return new Response(
        JSON.stringify({ error: 'At least one email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!['parent', 'staff', 'admin'].includes(role)) {
      return new Response(
        JSON.stringify({ error: 'Invalid role' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results: { email: string; success: boolean; code?: string; error?: string }[] = [];
    const siteUrl = Deno.env.get('SITE_URL') || 'http://localhost:5173';

    for (const email of emails) {
      const trimmedEmail = email.trim().toLowerCase();
      
      if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        results.push({ email: trimmedEmail, success: false, error: 'Invalid email format' });
        continue;
      }

      // Check if email already has an account
      const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
      const existingUser = existingUsers?.users?.find(u => u.email === trimmedEmail);
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

    return new Response(
      JSON.stringify({ 
        success: successCount > 0,
        message: `${successCount} invitation(s) created${failCount > 0 ? `, ${failCount} failed` : ''}`,
        registrationUrl: registrationBaseUrl,
        results,
        summary: { total: emails.length, success: successCount, failed: failCount }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in send-invites function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
