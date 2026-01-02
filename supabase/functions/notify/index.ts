// Notify Edge Function
// Send push notifications and SMS to parents

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { handleCorsPrefllight, jsonResponse, errorResponse } from '../_shared/cors.ts';

// Valid notification types
const VALID_NOTIFICATION_TYPES = ['order_placed', 'order_preparing', 'order_ready', 'order_completed', 'order_cancelled', 'custom'] as const;
type NotificationType = typeof VALID_NOTIFICATION_TYPES[number];

interface NotifyRequest {
  parent_id: string;
  type: 'order_placed' | 'order_preparing' | 'order_ready' | 'order_completed' | 'order_cancelled' | 'custom';
  order_id?: string;
  message?: string;
  title?: string;
}

// Notification templates
const NOTIFICATION_TEMPLATES = {
  order_placed: {
    title: 'Order Placed',
    body: 'Your order has been received and is being processed.'
  },
  order_preparing: {
    title: 'Order Preparing',
    body: 'The canteen is now preparing your order.'
  },
  order_ready: {
    title: 'Order Ready!',
    body: 'Your order is ready for pickup at the canteen.'
  },
  order_completed: {
    title: 'Order Completed',
    body: 'Your order has been picked up. Thank you!'
  },
  order_cancelled: {
    title: 'Order Cancelled',
    body: 'Your order has been cancelled. Please contact staff for details.'
  },
  custom: {
    title: 'School Canteen',
    body: 'You have a new notification.'
  }
};

serve(async (req) => {
  const origin = req.headers.get('Origin');

  // Handle CORS preflight
  const preflightResponse = handleCorsPrefllight(req);
  if (preflightResponse) return preflightResponse;

  try {
    // Get auth token from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse(
        { error: 'UNAUTHORIZED', message: 'Missing authorization header' },
        401,
        origin
      );
    }

    // Extract token from Bearer header
    const token = authHeader.replace('Bearer ', '');

    // Initialize Supabase client with service role
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Get user from token using admin client
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse(
        { error: 'UNAUTHORIZED', message: 'Invalid token' },
        401,
        origin
      );
    }

    const userRole = user.user_metadata?.role;
    if (!['staff', 'admin'].includes(userRole)) {
      return jsonResponse(
        { error: 'FORBIDDEN', message: 'Staff or admin access required' },
        403,
        origin
      );
    }

    // Parse request body
    const body: NotifyRequest = await req.json();
    const { parent_id, type, order_id, message, title } = body;

    if (!parent_id || !type) {
      return jsonResponse(
        { error: 'VALIDATION_ERROR', message: 'parent_id and type are required' },
        400,
        origin
      );
    }

    // Validate notification type
    if (!VALID_NOTIFICATION_TYPES.includes(type as NotificationType)) {
      return jsonResponse(
        { 
          error: 'VALIDATION_ERROR', 
          message: `Invalid notification type. Must be one of: ${VALID_NOTIFICATION_TYPES.join(', ')}` 
        },
        400,
        origin
      );
    }

    // Get parent details
    const { data: parent, error: parentError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, first_name, phone_number, email')
      .eq('id', parent_id)
      .single();

    if (parentError || !parent) {
      return jsonResponse(
        { error: 'NOT_FOUND', message: 'User not found' },
        404,
        origin
      );
    }

    // Get notification content
    const template = NOTIFICATION_TEMPLATES[type] || NOTIFICATION_TEMPLATES.custom;
    const notificationTitle = title || template.title;
    const notificationBody = message || template.body;

    const channels: string[] = [];
    const errors: string[] = [];

    // Send Push Notification (via Web Push or OneSignal)
    // TODO: Implement actual push notification service
    const pushEnabled = Deno.env.get('VAPID_PRIVATE_KEY');
    if (pushEnabled) {
      try {
        // Placeholder for Web Push implementation
        // In production, use web-push library or OneSignal API
        console.log(`[Push] Sending to ${parent_id}: ${notificationTitle} - ${notificationBody}`);
        channels.push('push');
      } catch (pushError) {
        console.error('Push notification error:', pushError);
        errors.push('push');
      }
    }

    // Send SMS (via Semaphore or Twilio)
    const smsApiKey = Deno.env.get('SMS_API_KEY');
    const smsProvider = Deno.env.get('SMS_PROVIDER') || 'semaphore';
    
    if (smsApiKey && parent.phone_number) {
      try {
        if (smsProvider === 'semaphore') {
          // Semaphore SMS API (Philippines)
          const smsResponse = await fetch('https://api.semaphore.co/api/v4/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apikey: smsApiKey,
              number: parent.phone_number,
              message: `${notificationTitle}\n${notificationBody}`,
              sendername: 'CANTEEN'
            })
          });

          if (smsResponse.ok) {
            channels.push('sms');
          } else {
            errors.push('sms');
          }
        } else if (smsProvider === 'twilio') {
          // Twilio SMS API
          const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
          const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');
          const twilioFromNumber = Deno.env.get('TWILIO_FROM_NUMBER');

          const smsResponse = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`,
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: new URLSearchParams({
                To: parent.phone_number,
                From: twilioFromNumber || '',
                Body: `${notificationTitle}\n${notificationBody}`
              })
            }
          );

          if (smsResponse.ok) {
            channels.push('sms');
          } else {
            errors.push('sms');
          }
        }
      } catch (smsError) {
        console.error('SMS notification error:', smsError);
        errors.push('sms');
      }
    }

    // Log notification (for history/debugging)
    console.log(`[Notify] Sent to ${parent.first_name} (${parent_id}): ${notificationTitle}`);
    console.log(`[Notify] Channels: ${channels.join(', ') || 'none'}`);
    if (errors.length) {
      console.log(`[Notify] Failed: ${errors.join(', ')}`);
    }

    return jsonResponse(
      {
        success: true,
        channels,
        message_id: crypto.randomUUID(),
        notification: {
          title: notificationTitle,
          body: notificationBody,
          order_id
        },
        errors: errors.length > 0 ? errors : undefined
      },
      200,
      origin
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return jsonResponse(
      { error: 'SERVER_ERROR', message: 'An unexpected error occurred' },
      500,
      origin
    );
  }
});
