// Create Topup Checkout Edge Function
// Creates a PayMongo Checkout Session for self-service wallet top-up

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPrefllight } from '../_shared/cors.ts';
import {
  createCheckoutSession,
  toCentavos,
  mapPaymentMethodTypes,
  buildCheckoutUrls,
} from '../_shared/paymongo.ts';

const MIN_TOPUP = 50;
const MAX_TOPUP = 50000;
const TOPUP_EXPIRY_MINUTES = 30;

interface TopupRequest {
  amount: number;
  payment_method?: 'gcash' | 'paymaya' | 'card';
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  const preflightResponse = handleCorsPrefllight(req);
  if (preflightResponse) return preflightResponse;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'CONFIG_ERROR', message: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // ── Auth ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Session expired or invalid. Please sign in again.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (user.app_metadata?.role !== 'parent') {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Only parents can top up wallets' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Parse request ──
    const body: TopupRequest = await req.json();
    const { amount, payment_method } = body;

    if (!amount || typeof amount !== 'number') {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Amount is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (amount < MIN_TOPUP) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: `Minimum top-up amount is ₱${MIN_TOPUP}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (amount > MAX_TOPUP) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: `Maximum top-up amount is ₱${MAX_TOPUP.toLocaleString()}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Round to 2 decimal places
    const roundedAmount = Math.round(amount * 100) / 100;

    console.log('Creating topup checkout:', { parent_id: user.id, amount: roundedAmount, payment_method });

    // ── Check system settings ──
    const { data: settingsData } = await supabaseAdmin.from('system_settings').select('key, value');
    const settings = new Map<string, unknown>();
    settingsData?.forEach(s => settings.set(s.key, s.value));

    if (settings.get('maintenance_mode') === true) {
      return new Response(
        JSON.stringify({ error: 'MAINTENANCE_MODE', message: 'The canteen is currently under maintenance.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Create topup session in DB ──
    const expiresAt = new Date(Date.now() + TOPUP_EXPIRY_MINUTES * 60 * 1000).toISOString();

    const { data: topupSession, error: insertError } = await supabaseAdmin
      .from('topup_sessions')
      .insert({
        parent_id: user.id,
        amount: roundedAmount,
        paymongo_checkout_id: 'pending', // Placeholder, will update after PayMongo call
        status: 'pending',
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (insertError || !topupSession) {
      console.error('Failed to create topup session:', insertError);
      return new Response(
        JSON.stringify({ error: 'SERVER_ERROR', message: 'Failed to create top-up session' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Create PayMongo Checkout Session ──
    let checkoutSession;
    try {
      const { successUrl, cancelUrl } = buildCheckoutUrls('topup', topupSession.id);
      const methodTypes = payment_method
        ? mapPaymentMethodTypes(payment_method)
        : ['gcash', 'paymaya', 'card'];

      checkoutSession = await createCheckoutSession({
        lineItems: [
          {
            name: `Wallet Top-Up ₱${roundedAmount.toLocaleString()}`,
            quantity: 1,
            amount: toCentavos(roundedAmount),
            currency: 'PHP',
          },
        ],
        paymentMethodTypes: methodTypes,
        description: 'School Canteen Wallet Top-Up',
        metadata: {
          type: 'topup',
          parent_id: user.id,
          topup_session_id: topupSession.id,
        },
        successUrl,
        cancelUrl,
      });

      // Update topup session with actual PayMongo checkout ID
      await supabaseAdmin
        .from('topup_sessions')
        .update({ paymongo_checkout_id: checkoutSession.id })
        .eq('id', topupSession.id);

    } catch (paymongoErr) {
      console.error('PayMongo topup checkout creation failed:', paymongoErr);
      // Clean up the session
      await supabaseAdmin.from('topup_sessions').delete().eq('id', topupSession.id);

      return new Response(
        JSON.stringify({ error: 'PAYMENT_ERROR', message: 'Online payments are temporarily unavailable. Please try again later.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log('Topup checkout session created:', { topup_session_id: topupSession.id, checkout_id: checkoutSession.id });

    return new Response(
      JSON.stringify({
        success: true,
        topup_session_id: topupSession.id,
        checkout_url: checkoutSession.attributes.checkout_url,
        expires_at: expiresAt,
        amount: roundedAmount,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'SERVER_ERROR', message: 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
