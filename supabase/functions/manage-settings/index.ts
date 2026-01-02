// Manage Settings Edge Function
// Handle system settings with validation, enforcement logic, and audit logging

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SettingsRequest {
  action: 'get' | 'update' | 'get-all' | 'check-maintenance';
  key?: string;
  value?: unknown;
  settings?: Record<string, unknown>;
}

// Valid setting keys and their validators
const SETTING_VALIDATORS: Record<string, (value: unknown) => boolean> = {
  canteen_name: (v) => typeof v === 'string' && v.length > 0 && v.length <= 100,
  operating_hours: (v) => {
    if (typeof v !== 'object' || !v) return false;
    const hours = v as { open?: string; close?: string };
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(hours.open || '') && timeRegex.test(hours.close || '');
  },
  order_cutoff_time: (v) => {
    if (typeof v !== 'string') return false;
    return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
  },
  allow_future_orders: (v) => typeof v === 'boolean',
  max_future_days: (v) => typeof v === 'number' && v >= 1 && v <= 30,
  low_stock_threshold: (v) => typeof v === 'number' && v >= 0 && v <= 1000,
  auto_complete_orders: (v) => typeof v === 'boolean',
  notification_email: (v) => v === null || (typeof v === 'string' && (v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))),
  maintenance_mode: (v) => typeof v === 'boolean',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const body: SettingsRequest = await req.json();
    const { action } = body;

    // check-maintenance doesn't require auth (used by app to check status)
    if (action === 'check-maintenance') {
      const { data } = await supabaseAdmin
        .from('system_settings')
        .select('value')
        .eq('key', 'maintenance_mode')
        .single();

      const maintenanceMode = data?.value === true || data?.value === 'true';
      
      return new Response(
        JSON.stringify({ maintenance_mode: maintenanceMode }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // All other actions require admin auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: true, message: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: true, message: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify admin role
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: true, message: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle actions
    switch (action) {
      case 'get': {
        const { key } = body;
        if (!key) {
          return new Response(
            JSON.stringify({ error: true, message: 'Setting key required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data, error } = await supabaseAdmin
          .from('system_settings')
          .select('*')
          .eq('key', key)
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ error: true, message: 'Setting not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ setting: data }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get-all': {
        const { data, error } = await supabaseAdmin
          .from('system_settings')
          .select('*');

        if (error) {
          return new Response(
            JSON.stringify({ error: true, message: 'Failed to fetch settings' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ settings: data || [] }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update': {
        const { settings } = body;
        if (!settings || typeof settings !== 'object') {
          return new Response(
            JSON.stringify({ error: true, message: 'Settings object required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Validate all settings before updating
        const errors: string[] = [];
        for (const [key, value] of Object.entries(settings)) {
          const validator = SETTING_VALIDATORS[key];
          if (!validator) {
            errors.push(`Unknown setting: ${key}`);
            continue;
          }
          if (!validator(value)) {
            errors.push(`Invalid value for ${key}`);
          }
        }

        if (errors.length > 0) {
          return new Response(
            JSON.stringify({ error: true, message: 'Validation failed', errors }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get current settings for audit log
        const { data: currentSettings } = await supabaseAdmin
          .from('system_settings')
          .select('key, value');

        const currentMap = new Map(currentSettings?.map(s => [s.key, s.value]) || []);

        // Update each setting
        const updates = [];
        for (const [key, value] of Object.entries(settings)) {
          const { error } = await supabaseAdmin
            .from('system_settings')
            .upsert({
              key,
              value,
              updated_at: new Date().toISOString()
            }, { onConflict: 'key' });

          if (error) {
            return new Response(
              JSON.stringify({ error: true, message: `Failed to update ${key}` }),
              { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          // Track changes for audit
          const oldValue = currentMap.get(key);
          if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
            updates.push({ key, old: oldValue, new: value });
          }
        }

        // Log to audit_logs if there were changes
        if (updates.length > 0) {
          await supabaseAdmin.from('audit_logs').insert({
            user_id: user.id,
            action: 'UPDATE',
            entity_type: 'system_settings',
            entity_id: 'system',
            old_data: Object.fromEntries(updates.map(u => [u.key, u.old])),
            new_data: Object.fromEntries(updates.map(u => [u.key, u.new])),
          });
        }

        return new Response(
          JSON.stringify({ success: true, updated: updates.length }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: true, message: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (err) {
    console.error('Settings error:', err);
    return new Response(
      JSON.stringify({ error: true, message: err instanceof Error ? err.message : 'Server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
