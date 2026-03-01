import { supabase } from './supabaseClient';
import { ensureValidSession } from './authSession';
import { queueOrder, isOnline } from './localQueue';

export interface CreateOrderRequest {
  parent_id: string;
  student_id: string;
  client_order_id: string;
  items: Array<{
    product_id: string;
    quantity: number;
    price_at_order: number;
    meal_period?: string;
  }>;
  payment_method: string;
  notes?: string;
  scheduled_for?: string;
  /** @deprecated Use items[].meal_period instead */
  meal_period?: string;
}

export interface BatchOrderGroup {
  student_id: string;
  client_order_id: string;
  items: Array<{
    product_id: string;
    quantity: number;
    price_at_order: number;
    meal_period?: string;
  }>;
  scheduled_for?: string;
}

export interface CreateBatchOrderRequest {
  parent_id: string;
  orders: BatchOrderGroup[];
  payment_method: 'cash' | 'balance';
  notes?: string;
}

export interface BatchOrderResponse {
  success: boolean;
  order_ids: string[];
  merged_order_ids?: string[];
  new_order_ids?: string[];
  merged?: boolean;
  orders: Array<{
    order_id: string;
    client_order_id: string;
    total_amount: number;
    status: string;
    payment_status: string;
    payment_due_at: string | null;
  }>;
  total_amount: number;
  message: string;
}

export interface OrderError {
  code: string;
  message: string;
  retryable: boolean;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function createOrder(orderData: CreateOrderRequest): Promise<{ order_id?: string; queued?: boolean }> {
  // Validate input
  if (!orderData.parent_id || !orderData.student_id) {
    throw new Error('Please select a student before placing an order.');
  }
  if (!orderData.items || orderData.items.length === 0) {
    throw new Error('Your cart is empty. Please add items before checking out.');
  }
  const validPaymentMethods = ['cash', 'balance', 'gcash', 'paymaya', 'card'];
  if (orderData.payment_method && !validPaymentMethods.includes(orderData.payment_method)) {
    throw new Error('Please select a valid payment method.');
  }

  // Online payment methods should use the create-checkout endpoint, not process-order
  const onlinePaymentMethods = ['gcash', 'paymaya', 'card'];
  if (orderData.payment_method && onlinePaymentMethods.includes(orderData.payment_method)) {
    throw new Error('Please use the online payment option for GCash, PayMaya, or Card.');
  }
  for (const item of orderData.items) {
    if (!item.product_id || item.quantity <= 0 || item.price_at_order < 0) {
      throw new Error('Some items in your cart are invalid. Please review and try again.');
    }
  }

  // Check if online
  if (!isOnline()) {
    // Queue for offline sync
    await queueOrder(orderData);
    return { queued: true };
  }

  // Ensure we have a valid session (auto-refreshes if needed)
  await ensureValidSession();

  // Process order via Edge Function with retry logic
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // supabase.functions.invoke automatically includes the Authorization header
      const { data, error } = await supabase.functions.invoke('process-order', {
        body: orderData
      });

      if (error) {
        // Extract the actual error message from the FunctionsHttpError
        // The error may contain a response body with the real message
        let errorMessage = error.message;
        
        // For FunctionsHttpError, try to get the response body
        // The Supabase client wraps errors, so we need to dig into them
        if (error.message === 'Edge Function returned a non-2xx status code') {
          // The data object may contain the actual error response
          if (data?.message) {
            errorMessage = data.message;
          } else if (data?.error) {
            errorMessage = data.error;
          } else {
            // Try to parse the error context if available
            try {
              // FunctionsHttpError has a 'context' property with response details
              const errAny = error as { context?: { json?: () => Promise<unknown> } };
              if (errAny.context?.json) {
                const body = await errAny.context.json();
                if (body && typeof body === 'object') {
                  const bodyObj = body as { message?: string; error?: string };
                  errorMessage = bodyObj.message || bodyObj.error || errorMessage;
                }
              }
            } catch {
              // If we can't parse, fall back to checking network issues
              if (!navigator.onLine) {
                errorMessage = 'No internet connection. Please check your network and try again.';
              } else {
                errorMessage = 'Unable to connect to server. Please try again in a moment.';
              }
            }
          }
        }
        
        // Check if the error has additional context (response body)
        if ('context' in error && error.context && errorMessage === error.message) {
          try {
            const context = error.context as { message?: string; error?: string };
            errorMessage = context.message || context.error || error.message;
          } catch {
            // Ignore parsing errors
          }
        }
        
        // Check if data contains error info (for non-2xx responses, data may still have body)
        if (data?.message && errorMessage === error.message) {
          errorMessage = data.message;
        } else if (data?.error && errorMessage === error.message) {
          errorMessage = data.error;
        }
        
        // Check if error is retryable
        const isRetryable = errorMessage?.includes('network') || 
                           errorMessage?.includes('timeout') ||
                           errorMessage?.includes('503') ||
                           errorMessage?.includes('502');
        
        if (isRetryable && attempt < MAX_RETRIES - 1) {
          lastError = new Error(errorMessage);
          await delay(RETRY_DELAY_MS * (attempt + 1)); // Exponential backoff
          continue;
        }
        throw new Error(errorMessage);
      }

      // Check for application-level errors in response
      if (data?.error) {
        throw new Error(data.message || data.error);
      }

      return data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      // If it's the last attempt, throw the error
      if (attempt === MAX_RETRIES - 1) {
        throw lastError;
      }
      
      // Only retry errors that are likely transient (network/server issues)
      const errMsg = lastError.message?.toLowerCase() || '';
      const isRetryable = errMsg.includes('network') ||
                         errMsg.includes('timeout') ||
                         errMsg.includes('503') ||
                         errMsg.includes('502') ||
                         errMsg.includes('fetch') ||
                         errMsg.includes('unable to connect');
      if (!isRetryable) {
        throw lastError;
      }
      
      await delay(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError || new Error('Failed to create order after multiple retries');
}

/**
 * Create multiple orders in a single request (cash/balance payments).
 * Replaces the sequential per-order createOrder loop, reducing N HTTP calls to 1.
 */
export async function createBatchOrder(batchData: CreateBatchOrderRequest): Promise<BatchOrderResponse> {
  // Validate input
  if (!batchData.parent_id) {
    throw new Error('Please sign in to continue.');
  }
  if (!batchData.orders || batchData.orders.length === 0) {
    throw new Error('Your cart is empty. Please add items before checking out.');
  }

  // Offline queueing — fallback to queuing each order individually
  if (!isOnline()) {
    for (const order of batchData.orders) {
      await queueOrder({
        parent_id: batchData.parent_id,
        student_id: order.student_id,
        client_order_id: order.client_order_id,
        items: order.items,
        payment_method: batchData.payment_method,
        notes: batchData.notes,
        scheduled_for: order.scheduled_for,
      });
    }
    return {
      success: true,
      order_ids: [],
      orders: [],
      total_amount: 0,
      message: 'Orders saved offline. Will sync when connected.',
    };
  }

  await ensureValidSession();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke('process-batch-order', {
        body: batchData,
      });

      if (error) {
        let errorMessage = error.message;

        if (error.message === 'Edge Function returned a non-2xx status code') {
          if (data?.message) {
            errorMessage = data.message;
          } else if (data?.error) {
            errorMessage = data.error;
          }
        }

        if (data?.message && errorMessage === error.message) {
          errorMessage = data.message;
        } else if (data?.error && errorMessage === error.message) {
          errorMessage = data.error;
        }

        const isRetryable = errorMessage?.includes('network') ||
          errorMessage?.includes('timeout') ||
          errorMessage?.includes('503') ||
          errorMessage?.includes('502');

        if (isRetryable && attempt < MAX_RETRIES - 1) {
          lastError = new Error(errorMessage);
          await delay(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        throw new Error(errorMessage);
      }

      if (data?.error) {
        throw new Error(data.message || data.error);
      }

      return data as BatchOrderResponse;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === MAX_RETRIES - 1) {
        throw lastError;
      }

      const errMsg = lastError.message?.toLowerCase() || '';
      const isRetryable = errMsg.includes('network') ||
        errMsg.includes('timeout') ||
        errMsg.includes('503') ||
        errMsg.includes('502') ||
        errMsg.includes('fetch') ||
        errMsg.includes('unable to connect');
      if (!isRetryable) {
        throw lastError;
      }

      await delay(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError || new Error('Failed to create batch orders after multiple retries');
}

const ORDER_PAGE_SIZE = 20;

export async function getOrderHistory(parentId: string, page = 0) {
  const from = page * ORDER_PAGE_SIZE;
  const to = from + ORDER_PAGE_SIZE - 1;

  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      child:students!orders_student_id_fkey(id, first_name, last_name),
      items:order_items(
        *,
        product:products(name, image_url)
      )
    `)
    .eq('parent_id', parentId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw error;
  return data;
}

export { ORDER_PAGE_SIZE };