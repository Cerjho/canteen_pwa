// Manage Settings Edge Function
// Handle system settings with validation, enforcement logic, and audit logging

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPrefllight } from '../_shared/cors.ts';

type SettingsAction = 'get' | 'update' | 'get-all' | 'check-maintenance' | 'archive-orders' | 'reset-stock';

interface SettingsRequest {
  action: SettingsAction;
  key?: string;
  value?: unknown;
  settings?: Record<string, unknown>;
  days?: number;
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
  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  const preflightResponse = handleCorsPrefllight(req);
  if (preflightResponse) return preflightResponse;

  try {
    console.log('manage-settings: Starting request');
    
    // Initialize Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const bodyText = await req.text();
    console.log('manage-settings: Request body:', bodyText);
    
    let body: SettingsRequest;
    try {
      body = JSON.parse(bodyText);
    } catch (parseErr) {
      console.error('manage-settings: JSON parse error:', parseErr);
      return new Response(
        JSON.stringify({ error: true, message: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const { action } = body;
    console.log('manage-settings: Action:', action);

    // Validate action upfront
    const validActions: SettingsAction[] = ['get', 'update', 'get-all', 'check-maintenance', 'archive-orders', 'reset-stock'];
    if (!validActions.includes(action)) {
      return new Response(
        JSON.stringify({ error: true, message: `Invalid action. Must be: ${validActions.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
      console.log('manage-settings: No auth header');
      return new Response(
        JSON.stringify({ error: true, message: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      console.log('manage-settings: Auth error:', authError?.message);
      return new Response(
        JSON.stringify({ error: true, message: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('manage-settings: User authenticated:', user.id);

    // Verify admin role from app_metadata (tamper-proof, server-only)
    const userRole = user.app_metadata?.role;
    if (userRole !== 'admin') {
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
        console.log('manage-settings: Update called with settings:', JSON.stringify(settings));
        
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
            errors.push(`Invalid value for ${key}: ${JSON.stringify(value)}`);
          }
        }

        console.log('manage-settings: Validation errors:', errors);

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
              value: value, // JSONB column - store the value directly
              updated_at: new Date().toISOString(),
              updated_by: user.id
            }, { onConflict: 'key' });

          if (error) {
            console.error('Update error for', key, ':', error);
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
          try {
            await supabaseAdmin.from('audit_logs').insert({
              user_id: user.id,
              action: 'UPDATE',
              entity_type: 'system_settings',
              entity_id: null, // UUID column - use null for system settings
              old_data: Object.fromEntries(updates.map(u => [u.key, u.old])),
              new_data: Object.fromEntries(updates.map(u => [u.key, u.new])),
            });
          } catch (auditErr) {
            console.error('Audit log error:', auditErr);
            // Don't fail the request if audit logging fails
          }
        }

        return new Response(
          JSON.stringify({ success: true, updated: updates.length }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'archive-orders': {
        // Archive completed/cancelled orders older than X days
        const days = (body as { days?: number }).days || 30;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        console.log('manage-settings: Archiving orders older than', cutoffDate.toISOString());

        // Delete old completed/cancelled orders
        const { data: oldOrders, error: fetchError } = await supabaseAdmin
          .from('orders')
          .select('id')
          .in('status', ['completed', 'cancelled'])
          .lt('created_at', cutoffDate.toISOString());

        if (fetchError) {
          console.error('Archive fetch error:', fetchError);
          return new Response(
            JSON.stringify({ error: true, message: 'Failed to fetch old orders' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const orderIds = oldOrders?.map(o => o.id) || [];
        console.log('manage-settings: Found', orderIds.length, 'orders to archive');

        if (orderIds.length > 0) {
          // Delete order items first (foreign key)
          await supabaseAdmin
            .from('order_items')
            .delete()
            .in('order_id', orderIds);

          // Delete orders
          const { error: deleteError } = await supabaseAdmin
            .from('orders')
            .delete()
            .in('id', orderIds);

          if (deleteError) {
            console.error('Archive delete error:', deleteError);
            return new Response(
              JSON.stringify({ error: true, message: 'Failed to archive orders' }),
              { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          // Audit log
          try {
            await supabaseAdmin.from('audit_logs').insert({
              user_id: user.id,
              action: 'DELETE',
              entity_type: 'orders',
              entity_id: null,
              new_data: { archived_count: orderIds.length, older_than_days: days },
            });
          } catch { /* ignore */ }
        }

        return new Response(
          JSON.stringify({ success: true, archived: orderIds.length }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'reset-stock': {
        // Reset all products to their default stock (or a configured default)
        console.log('manage-settings: Resetting stock for all products');

        // Get default stock from settings or use 50
        const { data: stockSetting } = await supabaseAdmin
          .from('system_settings')
          .select('value')
          .eq('key', 'default_stock_quantity')
          .single();

        const defaultStock = (stockSetting?.value as number) || 50;

        const { data: products, error: updateError } = await supabaseAdmin
          .from('products')
          .update({ stock_quantity: defaultStock })
          .select('id');

        if (updateError) {
          console.error('Reset stock error:', updateError);
          return new Response(
            JSON.stringify({ error: true, message: 'Failed to reset stock' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Audit log
        try {
          await supabaseAdmin.from('audit_logs').insert({
            user_id: user.id,
            action: 'UPDATE',
            entity_type: 'products',
            entity_id: null,
            new_data: { action: 'reset_stock', default_stock: defaultStock, products_updated: products?.length || 0 },
          });
        } catch { /* ignore */ }

        return new Response(
          JSON.stringify({ success: true, updated: products?.length || 0, default_stock: defaultStock }),
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