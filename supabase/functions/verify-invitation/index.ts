// Verify Invitation Edge Function
// Secure server-side invitation code verification

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPrefllight } from '../_shared/cors.ts';

// Simple in-memory rate limiting (per IP)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 5; // 5 attempts
const RATE_WINDOW = 60 * 1000; // per minute

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  
  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
    return false;
  }
  
  if (record.count >= RATE_LIMIT) {
    return true;
  }
  
  record.count++;
  return false;
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  const preflightResponse = handleCorsPrefllight(req);
  if (preflightResponse) return preflightResponse;

  try {
    // Get client IP for rate limiting
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 
                     req.headers.get('x-real-ip') || 
                     'unknown';

    // Check rate limit
    if (isRateLimited(clientIp)) {
      console.log(`Rate limited IP: ${clientIp}`);
      return new Response(
        JSON.stringify({ 
          error: 'RATE_LIMITED', 
          message: 'Too many attempts. Please wait a minute and try again.' 
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client with service role
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Parse request body
    const { code } = await req.json();

    if (!code) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Invitation code is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize and validate code format
    const normalizedCode = String(code).toUpperCase().trim();
    
    if (!/^[A-Z0-9]{6}$/.test(normalizedCode)) {
      // Don't reveal that the format is wrong - same error as invalid
      return new Response(
        JSON.stringify({ error: 'INVALID_CODE', message: 'Invalid invitation code.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch invitation - only select what's needed
    const { data: invitation, error: fetchError } = await supabaseAdmin
      .from('invitations')
      .select('email, role, expires_at, used')
      .eq('code', normalizedCode)
      .single();

    // Use consistent timing to prevent timing attacks
    const minResponseTime = 200;
    const startTime = Date.now();

    if (fetchError || !invitation) {
      // Add artificial delay to prevent timing attacks
      const elapsed = Date.now() - startTime;
      if (elapsed < minResponseTime) {
        await new Promise(resolve => setTimeout(resolve, minResponseTime - elapsed));
      }
      
      console.log(`Invalid code attempt: ${normalizedCode.substring(0, 2)}****`);
      return new Response(
        JSON.stringify({ error: 'INVALID_CODE', message: 'Invalid invitation code.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (invitation.used) {
      return new Response(
        JSON.stringify({ error: 'ALREADY_USED', message: 'This invitation has already been used.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (new Date(invitation.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'EXPIRED', message: 'This invitation has expired.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mask email for privacy (show only first 2 chars and domain)
    const emailParts = invitation.email.split('@');
    const maskedEmail = emailParts[0].substring(0, 2) + '***@' + emailParts[1];

    // Return minimal information needed
    return new Response(
      JSON.stringify({ 
        success: true,
        invitation: {
          email: maskedEmail,
          role: invitation.role,
          // Don't expose expires_at to client
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Verify invitation error:', error);
    return new Response(
      JSON.stringify({ error: 'SERVER_ERROR', message: 'Something went wrong.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
