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

  // Process order via Edge Function with retry logic
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke('process-order', {
        body: orderData
      });

      if (error) {
        // Check if error is retryable
        const isRetryable = error.message?.includes('network') || 
                           error.message?.includes('timeout') ||
                           error.message?.includes('503') ||
                           error.message?.includes('502');
        
        if (isRetryable && attempt < MAX_RETRIES - 1) {
          lastError = error;
          await delay(RETRY_DELAY_MS * (attempt + 1)); // Exponential backoff
          continue;
        }
        throw error;
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