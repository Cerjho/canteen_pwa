// Manage Profile Edge Function
// Secure server-side profile management for all user types

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Action = 'get' | 'update' | 'create';

interface ProfileData {
  first_name?: string;
  last_name?: string;
  phone_number?: string;
}

interface ManageProfileRequest {
  action: Action;
  data?: ProfileData;
}

// Validation
const MAX_NAME_LENGTH = 50;
const MAX_PHONE_LENGTH = 20;
const NAME_REGEX = /^[a-zA-ZÀ-ÿ\s\-'\.]+$/;
const PHONE_REGEX = /^[\d\s\+\-\(\)]+$/;

function sanitizeString(str: string, maxLen: number): string {
  return str.trim().slice(0, maxLen);
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

    const body: ManageProfileRequest = await req.json();
    const { action, data } = body;

    // Validate action
    const validActions: Action[] = ['get', 'update', 'create'];
    if (!validActions.includes(action)) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: `Invalid action. Must be: ${validActions.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    switch (action) {
      case 'get': {
        const { data: profile, error: fetchError } = await supabaseAdmin
          .from('user_profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();

        if (fetchError) {
          console.error('Profile fetch error:', fetchError);
          return new Response(
            JSON.stringify({ error: 'FETCH_FAILED', message: 'Failed to fetch profile' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // If no profile exists, return user metadata
        if (!profile) {
          return new Response(
            JSON.stringify({
              success: true,
              profile: {
                id: user.id,
                email: user.email,
                first_name: user.user_metadata?.first_name || '',
                last_name: user.user_metadata?.last_name || '',
                phone_number: user.user_metadata?.phone_number || null,
                created_at: user.created_at
              },
              exists: false
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, profile, exists: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'create': {
        // Check if profile already exists
        const { data: existing } = await supabaseAdmin
          .from('user_profiles')
          .select('id')
          .eq('id', user.id)
          .maybeSingle();

        if (existing) {
          return new Response(
            JSON.stringify({ error: 'PROFILE_EXISTS', message: 'Profile already exists. Use update instead.' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Validate data
        if (!data) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Profile data is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const firstName = sanitizeString(data.first_name || user.user_metadata?.first_name || '', MAX_NAME_LENGTH);
        const lastName = sanitizeString(data.last_name || user.user_metadata?.last_name || '', MAX_NAME_LENGTH);

        if (!firstName || !lastName) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'First and last name are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!NAME_REGEX.test(firstName) || !NAME_REGEX.test(lastName)) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Names contain invalid characters' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        let phoneNumber: string | null = null;
        if (data.phone_number) {
          phoneNumber = sanitizeString(data.phone_number, MAX_PHONE_LENGTH);
          if (!PHONE_REGEX.test(phoneNumber)) {
            return new Response(
              JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Invalid phone number format' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }

        const { data: newProfile, error: createError } = await supabaseAdmin
          .from('user_profiles')
          .insert({
            id: user.id,
            email: user.email,
            first_name: firstName,
            last_name: lastName,
            phone_number: phoneNumber,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select()
          .single();

        if (createError) {
          console.error('Profile create error:', createError);
          return new Response(
            JSON.stringify({ error: 'CREATE_FAILED', message: 'Failed to create profile' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] User ${user.email} created their profile`);

        return new Response(
          JSON.stringify({ success: true, profile: newProfile }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update': {
        if (!data || Object.keys(data).length === 0) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'No data provided for update' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const updateData: Record<string, any> = {
          updated_at: new Date().toISOString()
        };

        // Validate and sanitize each field
        if (data.first_name !== undefined) {
          const firstName = sanitizeString(data.first_name, MAX_NAME_LENGTH);
          if (!firstName) {
            return new Response(
              JSON.stringify({ error: 'VALIDATION_ERROR', message: 'First name cannot be empty' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          if (!NAME_REGEX.test(firstName)) {
            return new Response(
              JSON.stringify({ error: 'VALIDATION_ERROR', message: 'First name contains invalid characters' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          updateData.first_name = firstName;
        }

        if (data.last_name !== undefined) {
          const lastName = sanitizeString(data.last_name, MAX_NAME_LENGTH);
          if (!lastName) {
            return new Response(
              JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Last name cannot be empty' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          if (!NAME_REGEX.test(lastName)) {
            return new Response(
              JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Last name contains invalid characters' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          updateData.last_name = lastName;
        }

        if (data.phone_number !== undefined) {
          if (data.phone_number) {
            const phoneNumber = sanitizeString(data.phone_number, MAX_PHONE_LENGTH);
            if (!PHONE_REGEX.test(phoneNumber)) {
              return new Response(
                JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Invalid phone number format' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
            updateData.phone_number = phoneNumber;
          } else {
            updateData.phone_number = null;
          }
        }

        // Upsert profile (create if not exists, update if exists)
        const { data: updatedProfile, error: updateError } = await supabaseAdmin
          .from('user_profiles')
          .upsert({
            id: user.id,
            email: user.email,
            ...updateData
          }, {
            onConflict: 'id'
          })
          .select()
          .single();

        if (updateError) {
          console.error('Profile update error:', updateError);
          return new Response(
            JSON.stringify({ error: 'UPDATE_FAILED', message: 'Failed to update profile' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Also update user metadata in auth
        await supabaseAdmin.auth.admin.updateUserById(user.id, {
          user_metadata: {
            ...user.user_metadata,
            first_name: updateData.first_name || user.user_metadata?.first_name,
            last_name: updateData.last_name || user.user_metadata?.last_name,
            phone_number: updateData.phone_number !== undefined ? updateData.phone_number : user.user_metadata?.phone_number
          }
        });

        console.log(`[AUDIT] User ${user.email} updated their profile`);

        return new Response(
          JSON.stringify({ success: true, profile: updatedProfile }),
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
