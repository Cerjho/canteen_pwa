/**
 * Payment service for online payments (GCash, PayMaya, Card) via PayMongo
 * and self-service wallet top-ups.
 */

import { supabase } from './supabaseClient';
import type {
  CreateCheckoutResponse,
  CreateTopupCheckoutResponse,
  PaymentStatusResponse,
  PaymentMethod,
} from '../types';

export interface CreateCheckoutRequest {
  parent_id: string;
  student_id: string;
  client_order_id: string;
  items: Array<{
    product_id: string;
    quantity: number;
    price_at_order: number;
  }>;
  payment_method: 'gcash' | 'paymaya' | 'card';
  notes?: string;
  scheduled_for?: string;
  meal_period?: string;
}

export interface CreateTopupRequest {
  amount: number;
  payment_method?: 'gcash' | 'paymaya' | 'card';
}

/**
 * Create a PayMongo checkout session for an online payment order.
 * Returns the checkout_url to redirect the user to.
 */
export async function createCheckout(
  orderData: CreateCheckoutRequest
): Promise<CreateCheckoutResponse> {
  // Ensure we have a valid session
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError || !sessionData.session) {
    throw new Error('Please sign in again to place an order');
  }

  // Refresh token if needed
  const expiresAt = sessionData.session.expires_at;
  if (expiresAt && expiresAt * 1000 - Date.now() < 120000) {
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      throw new Error('Session expired. Please sign in again.');
    }
  }

  const { data, error } = await supabase.functions.invoke('create-checkout', {
    body: orderData,
  });

  if (error) {
    // Try to extract meaningful error message
    let errorMessage = error.message;
    if (data?.message) {
      errorMessage = data.message;
    } else if (data?.error) {
      errorMessage = data.error;
    }
    throw new Error(errorMessage);
  }

  if (data?.error) {
    throw new Error(data.message || data.error);
  }

  return data as CreateCheckoutResponse;
}

/**
 * Create a PayMongo checkout session for a wallet top-up.
 * Returns the checkout_url to redirect the user to.
 */
export async function createTopupCheckout(
  topupData: CreateTopupRequest
): Promise<CreateTopupCheckoutResponse> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError || !sessionData.session) {
    throw new Error('Please sign in again');
  }

  const { data, error } = await supabase.functions.invoke('create-topup-checkout', {
    body: topupData,
  });

  if (error) {
    let errorMessage = error.message;
    if (data?.message) errorMessage = data.message;
    else if (data?.error) errorMessage = data.error;
    throw new Error(errorMessage);
  }

  if (data?.error) {
    throw new Error(data.message || data.error);
  }

  return data as CreateTopupCheckoutResponse;
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
    throw new Error(error.message || 'Failed to check payment status');
  }

  return data as PaymentStatusResponse;
}

/**
 * Check the status of a top-up session (poll after PayMongo redirect).
 */
export async function checkTopupStatus(
  topupSessionId: string
): Promise<PaymentStatusResponse> {
  const { data, error } = await supabase.functions.invoke('check-payment-status', {
    body: { topup_session_id: topupSessionId },
  });

  if (error) {
    throw new Error(error.message || 'Failed to check top-up status');
  }

  return data as PaymentStatusResponse;
}

/**
 * Get the display label for a payment method
 */
export function getPaymentMethodLabel(method: PaymentMethod | string): string {
  switch (method) {
    case 'cash':
      return 'Cash';
    case 'balance':
      return 'Wallet Balance';
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
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError || !sessionData.session) {
    throw new Error('Please sign in again to retry payment');
  }

  // Refresh token if needed
  const expiresAt = sessionData.session.expires_at;
  if (expiresAt && expiresAt * 1000 - Date.now() < 120000) {
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      throw new Error('Session expired. Please sign in again.');
    }
  }

  const { data, error } = await supabase.functions.invoke('retry-checkout', {
    body: { order_id: orderId },
  });

  if (error) {
    let errorMessage = error.message;
    if (data?.message) errorMessage = data.message;
    else if (data?.error) errorMessage = data.error;
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
    case 'balance':
      return 'Pay with Balance';
    case 'cash':
    default:
      return 'Place Order';
  }
}
