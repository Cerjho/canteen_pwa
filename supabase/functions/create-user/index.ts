import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateUserRequest {
  email?: string; // Single email for create mode
  emails?: string[]; // Multiple emails for bulk invite
  password?: string; // Required for create mode
  role: 'parent' | 'staff' | 'admin';
  firstName?: string; // Optional for invite, required for create
  lastName?: string; // Optional for invite, required for create
  phoneNumber?: string;
  mode: 'create' | 'invite'; // create = set password, invite = send email
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify the requesting user is an admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with service role for admin operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verify requesting user is admin
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
        JSON.stringify({ error: 'Only admins can create users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const { email, emails, password, role, firstName, lastName, phoneNumber, mode = 'create' }: CreateUserRequest = await req.json();

    if (!['parent', 'staff', 'admin'].includes(role)) {
      return new Response(
        JSON.stringify({ error: 'Invalid role. Must be parent, staff, or admin' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle INVITE mode (bulk create with default password)
    if (mode === 'invite') {
      const emailList = emails || (email ? [email] : []);
      
      if (emailList.length === 0) {
        return new Response(
          JSON.stringify({ error: 'At least one email is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const defaultPassword = 'Welcome123!';
      const results: { email: string; success: boolean; error?: string }[] = [];

      for (const inviteEmail of emailList) {
        const trimmedEmail = inviteEmail.trim().toLowerCase();
        
        if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
          results.push({ email: trimmedEmail, success: false, error: 'Invalid email format' });
          continue;
        }

        try {
          // Create user with default password and needs_setup flag
          const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email: trimmedEmail,
            password: defaultPassword,
            email_confirm: true,
            user_metadata: {
              role,
              needs_setup: true, // Flag to trigger onboarding
              first_name: '',
              last_name: '',
            },
          });

          if (createError) {
            results.push({ email: trimmedEmail, success: false, error: createError.message });
          } else {
            // For parent role, create entry in parents table
            if (role === 'parent' && newUser.user) {
              await supabaseAdmin
                .from('parents')
                .insert({
                  id: newUser.user.id,
                  email: trimmedEmail,
                  first_name: '',
                  last_name: '',
                  phone_number: null,
                  balance: 0,
                });
            }
            results.push({ email: trimmedEmail, success: true });
          }
        } catch (err) {
          results.push({ email: trimmedEmail, success: false, error: 'Failed to create user' });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      return new Response(
        JSON.stringify({ 
          success: successCount > 0,
          mode: 'invite',
          defaultPassword, // Return so admin can share it
          message: `${successCount} user(s) created${failCount > 0 ? `, ${failCount} failed` : ''}`,
          results,
          summary: { total: emailList.length, success: successCount, failed: failCount }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle CREATE mode (single user with password)
    if (!email || !firstName || !lastName) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: email, firstName, lastName' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!password) {
      return new Response(
        JSON.stringify({ error: 'Password is required for create mode' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: 'Password must be at least 6 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create user with password directly
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role,
        first_name: firstName,
        last_name: lastName,
      },
    });

    if (createError) {
      return new Response(
        JSON.stringify({ error: createError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If parent, create entry in parents table
    if (role === 'parent' && newUser.user) {
      const { error: parentError } = await supabaseAdmin
        .from('parents')
        .insert({
          id: newUser.user.id,
          email,
          first_name: firstName,
          last_name: lastName,
          phone_number: phoneNumber || null,
          balance: 0,
        });

      if (parentError) {
        console.error('Error creating parent record:', parentError);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        mode: 'create',
        message: `User ${email} created successfully`,
        user: {
          id: newUser.user?.id,
          email: newUser.user?.email,
          role,
          firstName,
          lastName,
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in create-user function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
