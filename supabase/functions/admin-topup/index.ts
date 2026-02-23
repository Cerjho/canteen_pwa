// Admin Top-Up Edge Function
// Secure server-side balance management

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPrefllight } from '../_shared/cors.ts';

interface TopUpRequest {
  user_id: string;
  amount: number;
  notes?: string;
}

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

    // Verify admin user
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user is admin
    const userRole = user.app_metadata?.role;
    if (userRole !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: TopUpRequest = await req.json();
    const { user_id, amount, notes } = body;

    // Validate request
    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'amount must be a positive number' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (amount > 50000) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Amount exceeds maximum limit of ₱50,000' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify target user exists and is a parent
    const { data: targetUser, error: userError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, role, first_name, last_name')
      .eq('id', user_id)
      .single();

    if (userError || !targetUser) {
      return new Response(
        JSON.stringify({ error: 'USER_NOT_FOUND', message: 'Target user not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (targetUser.role !== 'parent') {
      return new Response(
        JSON.stringify({ error: 'INVALID_USER', message: 'Can only top up parent accounts' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get current balance for the response (before atomic topup)
    const { data: walletBefore } = await supabaseAdmin
      .from('wallets')
      .select('balance')
      .eq('user_id', user_id)
      .single();
    const previousBalance = walletBefore?.balance ?? 0;

    // Atomic: wallet credit + topup payment record in one DB transaction
    const referenceId = notes
      ? `TOPUP-${Date.now()}-${user.id.slice(-6)}: ${notes}`
      : `TOPUP-${Date.now()}-${user.id.slice(-6)}`;

    const { data: rpcId, error: rpcError } = await supabaseAdmin.rpc(
      'credit_balance_with_payment',
      {
        p_parent_id: user_id,
        p_amount: amount,
        p_type: 'topup',
        p_method: 'cash',
        p_reference_id: referenceId,
      }
    );

    if (rpcError) {
      console.error('Atomic topup error:', rpcError);
      return new Response(
        JSON.stringify({ error: 'TOPUP_FAILED', message: 'Failed to process top-up. Please retry.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const newBalance = previousBalance + amount;

    // Log admin action
    console.log(`Admin ${user.email} topped up ${targetUser.first_name} ${targetUser.last_name} (${user_id}) by ₱${amount}. Previous: ₱${previousBalance}, New: ₱${newBalance}`);

    return new Response(
      JSON.stringify({
        success: true,
        user_id,
        previous_balance: previousBalance,
        amount,
        new_balance: newBalance
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'SERVER_ERROR', message: 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
