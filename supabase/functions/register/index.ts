// Register Edge Function
// Secure server-side registration with invitation validation

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RegisterRequest {
  invitation_code: string;
  first_name: string;
  last_name: string;
  phone_number?: string;
  password: string;
}

function sanitizeString(str: string | undefined, maxLength: number = 100): string {
  if (!str) return '';
  return str.trim().slice(0, maxLength).replace(/[<>]/g, '');
}

function validatePhoneNumber(phone: string): boolean {
  if (!phone) return true; // Optional field
  // Philippine phone number format: 09XXXXXXXXX or +639XXXXXXXXX
  const pattern = /^(\+63|0)9\d{9}$/;
  return pattern.test(phone.replace(/\s|-/g, ''));
}

function validatePassword(password: string): { valid: boolean; error?: string } {
  if (!password || password.length < 6) {
    return { valid: false, error: 'Password must be at least 6 characters' };
  }
  if (password.length > 72) {
    return { valid: false, error: 'Password cannot exceed 72 characters' };
  }
  return { valid: true };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client with service role for admin operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Parse request body
    const body: RegisterRequest = await req.json();
    const { invitation_code, first_name, last_name, phone_number, password } = body;

    // Validate required fields
    if (!invitation_code) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Invitation code is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!first_name || !last_name) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'First name and last name are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate password
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: passwordValidation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate phone number if provided
    if (phone_number && !validatePhoneNumber(phone_number)) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Invalid phone number format. Use 09XXXXXXXXX or +639XXXXXXXXX' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize invitation code
    const normalizedCode = invitation_code.toUpperCase().trim();

    // Validate code format (6 alphanumeric characters)
    if (!/^[A-Z0-9]{6}$/.test(normalizedCode)) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Invalid invitation code format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch invitation
    const { data: invitation, error: invitationError } = await supabaseAdmin
      .from('invitations')
      .select('id, email, role, expires_at, used')
      .eq('code', normalizedCode)
      .single();

    if (invitationError || !invitation) {
      console.log(`Invalid invitation code attempt: ${normalizedCode}`);
      return new Response(
        JSON.stringify({ error: 'INVALID_CODE', message: 'Invalid invitation code. Please check and try again.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if invitation is already used
    if (invitation.used) {
      return new Response(
        JSON.stringify({ error: 'ALREADY_USED', message: 'This invitation has already been used.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if invitation is expired
    if (new Date(invitation.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'EXPIRED', message: 'This invitation has expired. Please contact your admin for a new one.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate role
    const validRoles = ['parent', 'staff', 'admin'];
    if (!validRoles.includes(invitation.role)) {
      console.error(`Invalid role in invitation: ${invitation.role}`);
      return new Response(
        JSON.stringify({ error: 'SERVER_ERROR', message: 'Invalid invitation configuration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if email already exists
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const emailExists = existingUsers?.users?.some(u => u.email === invitation.email);
    if (emailExists) {
      return new Response(
        JSON.stringify({ error: 'EMAIL_EXISTS', message: 'An account with this email already exists.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Sanitize input
    const sanitizedFirstName = sanitizeString(first_name, 50);
    const sanitizedLastName = sanitizeString(last_name, 50);
    const sanitizedPhone = phone_number ? phone_number.replace(/\s|-/g, '').slice(0, 15) : null;

    // Create user account using admin API
    const { data: newUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
      email: invitation.email,
      password: password,
      email_confirm: true, // Auto-confirm since they have invitation
      user_metadata: {
        role: invitation.role,
        first_name: sanitizedFirstName,
        last_name: sanitizedLastName,
      },
    });

    if (createUserError || !newUser.user) {
      console.error('Failed to create user:', createUserError);
      return new Response(
        JSON.stringify({ error: 'SERVER_ERROR', message: 'Failed to create account. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create user profile record for all roles
    const { error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .insert({
        id: newUser.user.id,
        email: invitation.email,
        first_name: sanitizedFirstName,
        last_name: sanitizedLastName,
        phone_number: sanitizedPhone,
      });

    if (profileError) {
      console.error('Error creating user profile:', profileError);
    }

    // Create wallet for parents
    if (invitation.role === 'parent') {
      const { error: walletError } = await supabaseAdmin
        .from('wallets')
        .insert({
          user_id: newUser.user.id,
          balance: 0,
        });

      if (walletError) {
        console.error('Error creating wallet:', walletError);
      }
    }

    // Mark invitation as used (with atomic update to prevent race conditions)
    const { error: updateError } = await supabaseAdmin
      .from('invitations')
      .update({ 
        used: true, 
        used_at: new Date().toISOString(),
        used_by: newUser.user.id 
      })
      .eq('id', invitation.id)
      .eq('used', false); // Ensure it hasn't been used in the meantime

    if (updateError) {
      console.error('Error marking invitation as used:', updateError);
    }

    console.log(`SUCCESS: User registered with email ${invitation.email}, role ${invitation.role}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        user: {
          id: newUser.user.id,
          email: newUser.user.email,
          role: invitation.role,
        },
        message: 'Account created successfully. You can now log in.'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Register error:', error);
    return new Response(
      JSON.stringify({ error: 'SERVER_ERROR', message: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
