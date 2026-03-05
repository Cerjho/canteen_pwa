/**
 * Payment service for online payments (GCash, PayMaya, Card) via PayMongo.
 * Handles weekly pre-order checkout, surplus checkout, and payment status polling.
 */

import { supabase } from './supabaseClient';
import { ensureValidSession } from './authSession';
import { friendlyError } from '../utils/friendlyError';
import type {
  CreateCheckoutResponse,
  WeeklyCheckoutResponse,
  PaymentStatusResponse,
  PaymentMethod,
  CreateWeeklyOrderRequest,
} from '../types';

/**
 * Extract a meaningful error message from a Supabase Edge Function error.
 * The Supabase JS client wraps non-2xx responses in FunctionsHttpError,
 * and the actual JSON body may be in `error.context` or in `data`.
 */
async function extractEdgeFunctionError(error: Error & { context?: unknown }, data: unknown): Promise<string> {
  // 1. Check if data already has the error message (some Supabase client versions put it here)
  const d = data as { message?: string; error?: string } | null;
  if (d?.message) return d.message;
  if (d?.error) return d.error;

  // 2. Try to parse error.context (FunctionsHttpError wraps the Response here)
  if (error.message === 'Edge Function returned a non-2xx status code' && error.context) {
    try {
      // context may be a Response-like object with .json()
      const ctx = error.context as { json?: () => Promise<unknown> };
      if (typeof ctx.json === 'function') {
        const body = await ctx.json() as { message?: string; error?: string };
        if (body?.message) return body.message;
        if (body?.error) return body.error;
      }
    } catch {
      // ignore parse failures
    }
    try {
      // context may be a plain object
      const ctx = error.context as { message?: string; error?: string };
      if (ctx?.message) return ctx.message;
      if (ctx?.error) return ctx.error;
    } catch {
      // ignore
    }
  }

  // 3. Fallback: check network
  if (error.message === 'Edge Function returned a non-2xx status code') {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return 'No internet connection. Please check your network and try again.';
    }
    return 'Unable to connect to server. Please try again in a moment.';
  }

  return friendlyError(error.message, 'process your request');
}

/**
 * Create a PayMongo checkout session for a weekly pre-order.
 * Calls the create-weekly-checkout edge function which creates the
 * weekly_orders record + daily orders + a single PayMongo session.
 */
export async function createWeeklyCheckout(
  req: CreateWeeklyOrderRequest,
): Promise<WeeklyCheckoutResponse> {
  await ensureValidSession();

  const { data, error } = await supabase.functions.invoke('create-weekly-checkout', {
    body: req,
  });

  if (error) {
    const errorMessage = await extractEdgeFunctionError(error, data);
    throw new Error(errorMessage);
  }

  if (data?.error) {
    throw new Error(data.message || data.error);
  }

  return data as WeeklyCheckoutResponse;
}

/**
 * Check the payment status of an order (poll after PayMongo redirect).
 */
export async function checkPaymentStatus(
  orderId: string
): Promise<PaymentStatusResponse> {
  const { data, error } = await supabase.functions.invoke('check-payment-status', {
    body: { order_id: orderId },
  });

  if (error) {
    const errorMessage = await extractEdgeFunctionError(error, data);
    throw new Error(friendlyError(errorMessage, 'check payment status'));
  }

  return data as PaymentStatusResponse;
}

/**
 * Get the display label for a payment method.
 */
export function getPaymentMethodLabel(method: PaymentMethod | string): string {
  switch (method) {
    case 'cash':
      return 'Cash';
    case 'gcash':
      return 'GCash';
    case 'paymaya':
      return 'PayMaya';
    case 'card':
      return 'Credit/Debit Card';
    default:
      return method;
  }
}

/**
 * Retry payment for an existing order that was cancelled or still awaiting payment.
 * Creates a new PayMongo checkout session for the same order.
 */
export async function retryCheckout(
  orderId: string
): Promise<CreateCheckoutResponse> {
  // Ensure we have a valid session (auto-refreshes if needed)
  await ensureValidSession();

  const { data, error } = await supabase.functions.invoke('retry-checkout', {
    body: { order_id: orderId },
  });

  if (error) {
    const errorMessage = await extractEdgeFunctionError(error, data);
    throw new Error(errorMessage);
  }

  if (data?.error) {
    throw new Error(data.message || data.error);
  }

  return data as CreateCheckoutResponse;
}

/**
 * Get the checkout button text for a payment method
 */
export function getCheckoutButtonText(method: PaymentMethod): string {
  switch (method) {
    case 'gcash':
      return 'Pay with GCash';
    case 'paymaya':
      return 'Pay with PayMaya';
    case 'card':
      return 'Pay with Card';
    case 'cash':
    default:
      return 'Place Order';
  }
}
