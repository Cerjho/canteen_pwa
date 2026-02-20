// Check Payment Status Edge Function
// Simple DB lookup for frontend to poll payment status after PayMongo redirect
// Does NOT call PayMongo API — webhook updates DB, this just reads it.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPrefllight } from '../_shared/cors.ts';

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
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Session expired or invalid.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Parse request ──
    // Accept both GET query params and POST body
    let orderId: string | null = null;
    let topupSessionId: string | null = null;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      orderId = url.searchParams.get('order_id');
      topupSessionId = url.searchParams.get('topup_session_id');
    } else {
      const body = await req.json();
      orderId = body.order_id || null;
      topupSessionId = body.topup_session_id || null;
    }

    // ── Check order payment status ──
    if (orderId) {
      const { data: order, error: orderError } = await supabaseAdmin
        .from('orders')
        .select('id, status, payment_status, payment_method, total_amount, parent_id')
        .eq('id', orderId)
        .single();

      if (orderError || !order) {
        return new Response(
          JSON.stringify({ error: 'NOT_FOUND', message: 'Order not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // Only allow parents to check their own orders
      if (order.parent_id !== user.id && user.app_metadata?.role !== 'admin') {
        return new Response(
          JSON.stringify({ error: 'FORBIDDEN', message: 'Access denied' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({
          order_id: order.id,
          payment_status: order.payment_status,
          order_status: order.status,
          payment_method: order.payment_method,
          total_amount: order.total_amount,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Check topup session status ──
    if (topupSessionId) {
      const { data: topup, error: topupError } = await supabaseAdmin
        .from('topup_sessions')
        .select('id, status, amount, payment_method, parent_id, completed_at')
        .eq('id', topupSessionId)
        .single();

      if (topupError || !topup) {
        return new Response(
          JSON.stringify({ error: 'NOT_FOUND', message: 'Top-up session not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      if (topup.parent_id !== user.id) {
        return new Response(
          JSON.stringify({ error: 'FORBIDDEN', message: 'Access denied' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({
          topup_session_id: topup.id,
          status: topup.status,
          amount: topup.amount,
          payment_method: topup.payment_method,
          completed_at: topup.completed_at,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Provide order_id or topup_session_id' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'SERVER_ERROR', message: 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
