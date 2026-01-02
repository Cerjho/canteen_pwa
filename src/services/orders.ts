import { supabase } from './supabaseClient';
import { queueOrder, isOnline } from './localQueue';

export interface CreateOrderRequest {
  parent_id: string;
  student_id: string;
  client_order_id: string;
  items: Array<{
    product_id: string;
    quantity: number;
    price_at_order: number;
  }>;
  payment_method: string;
  notes?: string;
  scheduled_for?: string;
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
    throw new Error('Parent ID and Student ID are required');
  }
  if (!orderData.items || orderData.items.length === 0) {
    throw new Error('At least one item is required');
  }
  for (const item of orderData.items) {
    if (!item.product_id || item.quantity <= 0 || item.price_at_order < 0) {
      throw new Error('Invalid order item: product_id required, quantity must be positive, price must be non-negative');
    }
  }

  // Check if online
  if (!isOnline()) {
    // Queue for offline sync
    await queueOrder(orderData);
    return { queued: true };
  }

  // Ensure we have a valid session before making the request
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  
  if (sessionError || !sessionData.session) {
    throw new Error('Please sign in again to place an order');
  }
  
  // Refresh token if it's about to expire (within 2 minutes)
  const expiresAt = sessionData.session.expires_at;
  if (expiresAt && expiresAt * 1000 - Date.now() < 120000) {
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      throw new Error('Session expired. Please sign in again.');
    }
    // Use the refreshed session
    if (!refreshData.session) {
      throw new Error('Failed to refresh session. Please sign in again.');
    }
  }

  // Process order via Edge Function with retry logic
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // supabase.functions.invoke automatically includes the Authorization header
      const { data, error } = await supabase.functions.invoke('process-order', {
        body: orderData
      });

      if (error) {
        // Try to extract the actual error message from the response
        // FunctionsHttpError may have context with the response body
        let errorMessage = error.message;
        
        // Check if the error has additional context (response body)
        if ('context' in error && error.context) {
          try {
            const context = error.context as { message?: string; error?: string };
            errorMessage = context.message || context.error || error.message;
          } catch {
            // Ignore parsing errors
          }
        }
        
        // Check if data contains error info (for non-2xx responses, data may still have body)
        if (data?.message) {
          errorMessage = data.message;
        } else if (data?.error) {
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
      
      await delay(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError || new Error('Failed to create order after multiple retries');
}

export async function getOrderHistory(parentId: string) {
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
    .limit(50);

  if (error) throw error;
  return data;
}