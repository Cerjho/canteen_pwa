import { supabase } from './supabaseClient';
import { ensureValidSession } from './authSession';
import { queueOrder, isOnline } from './localQueue';
import type {
  CreateWeeklyOrderRequest,
  CreateSurplusOrderRequest,
  WeeklyOrderResponse,
  SurplusOrderResponse,
  OrderWithDetails,
  WeeklyOrderWithDetails,
} from '../types';

// ── Legacy batch types (kept for backward compatibility) ──

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
  payment_method: 'cash';
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
const ORDER_PAGE_SIZE = 20;

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract a meaningful error message from a Supabase Edge Function error.
 */
async function extractEdgeFunctionError(error: Error & { context?: unknown }, data: unknown): Promise<string> {
  const d = data as { message?: string; error?: string } | null;
  if (d?.message) return d.message;
  if (d?.error) return d.error;

  if (error.message === 'Edge Function returned a non-2xx status code' && error.context) {
    try {
      const ctx = error.context as { json?: () => Promise<unknown> };
      if (typeof ctx.json === 'function') {
        const body = await ctx.json() as { message?: string; error?: string };
        if (body?.message) return body.message;
        if (body?.error) return body.error;
      }
    } catch { /* ignore */ }
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'No internet connection. Please check your network and try again.';
  }
  return 'Unable to connect to server. Please try again in a moment.';
}

/**
 * Call an edge function with retry logic for transient errors.
 */
async function invokeWithRetry<T>(
  fnName: string,
  body: Record<string, unknown> | object,
): Promise<T> {
  await ensureValidSession();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke(fnName, { body });

      if (error) {
        const msg = await extractEdgeFunctionError(error, data);
        const isRetryable = /network|timeout|503|502/i.test(msg);
        if (isRetryable && attempt < MAX_RETRIES - 1) {
          lastError = new Error(msg);
          await delay(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        throw new Error(msg);
      }

      if (data?.error) {
        throw new Error(data.message || data.error);
      }

      return data as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === MAX_RETRIES - 1) throw lastError;

      const errMsg = lastError.message?.toLowerCase() || '';
      const isRetryable = /network|timeout|503|502|fetch|unable to connect/i.test(errMsg);
      if (!isRetryable) throw lastError;
      await delay(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError || new Error(`Failed to call ${fnName} after multiple retries`);
}

// ══════════════════════════════════════════════════════════════
// Weekly Pre-Order Functions
// ══════════════════════════════════════════════════════════════

/**
 * Create a weekly pre-order (cash payment).
 * Calls the process-weekly-order edge function.
 */
export async function createWeeklyOrder(
  req: CreateWeeklyOrderRequest,
): Promise<WeeklyOrderResponse> {
  if (!req.parent_id) throw new Error('Please sign in to continue.');
  if (!req.student_id) throw new Error('Please select a student.');
  if (!req.week_start) throw new Error('Week start date is required.');
  if (!req.days || req.days.length === 0) throw new Error('Please add items to at least one day.');

  // Offline queueing for cash orders
  if (req.payment_method === 'cash' && !isOnline()) {
    for (const day of req.days) {
      await queueOrder({
        parent_id: req.parent_id,
        student_id: req.student_id,
        client_order_id: crypto.randomUUID(),
        items: day.items,
        payment_method: 'cash',
        notes: req.notes,
        scheduled_for: day.scheduled_for,
      });
    }
    return {
      success: true,
      weekly_order_id: '',
      order_ids: [],
      total_amount: 0,
      payment_status: 'queued',
      message: 'Orders saved offline. Will sync when connected.',
    };
  }

  return invokeWithRetry<WeeklyOrderResponse>('process-weekly-order', req);
}

/**
 * Create a surplus order (cash payment).
 * Calls the process-surplus-order edge function.
 */
export async function createSurplusOrder(
  req: CreateSurplusOrderRequest,
): Promise<SurplusOrderResponse> {
  if (!req.parent_id) throw new Error('Please sign in to continue.');
  if (!req.student_id) throw new Error('Please select a student.');
  if (!req.items || req.items.length === 0) throw new Error('Please add items before ordering.');

  return invokeWithRetry<SurplusOrderResponse>('process-surplus-order', req);
}

/**
 * Cancel an individual day from a weekly order.
 * Only allowed before 8:00 AM on the day being cancelled.
 */
export async function cancelDayFromWeeklyOrder(
  orderId: string,
  reason?: string,
): Promise<void> {
  if (!orderId) throw new Error('Order ID is required.');

  await invokeWithRetry<unknown>('parent-cancel-order', {
    order_id: orderId,
    reason: reason || 'Parent cancelled (student absent)',
  });
}

// ══════════════════════════════════════════════════════════════
// Weekly Order Queries
// ══════════════════════════════════════════════════════════════

/**
 * Get paginated weekly orders for a parent.
 */
export async function getWeeklyOrders(parentId: string, page = 0): Promise<WeeklyOrderWithDetails[]> {
  const from = page * ORDER_PAGE_SIZE;
  const to = from + ORDER_PAGE_SIZE - 1;

  const { data, error } = await supabase
    .from('weekly_orders')
    .select(`
      *,
      student:students!weekly_orders_student_id_fkey(id, first_name, last_name),
      daily_orders:orders!orders_weekly_order_id_fkey(
        *,
        items:order_items(
          *,
          product:products(name, image_url)
        )
      )
    `)
    .eq('parent_id', parentId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw error;
  return (data || []) as WeeklyOrderWithDetails[];
}

/**
 * Get a single weekly order with full details.
 */
export async function getWeeklyOrderDetail(weeklyOrderId: string): Promise<WeeklyOrderWithDetails | null> {
  const { data, error } = await supabase
    .from('weekly_orders')
    .select(`
      *,
      student:students!weekly_orders_student_id_fkey(id, first_name, last_name),
      daily_orders:orders!orders_weekly_order_id_fkey(
        *,
        items:order_items(
          *,
          product:products(name, image_url)
        )
      )
    `)
    .eq('id', weeklyOrderId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data as WeeklyOrderWithDetails;
}

// ══════════════════════════════════════════════════════════════
// Legacy Batch Order (kept for backward compatibility)
// ══════════════════════════════════════════════════════════════

/**
 * Create multiple orders in a single request (cash only).
 * @deprecated For weekly pre-orders, use createWeeklyOrder instead.
 */
export async function createBatchOrder(batchData: CreateBatchOrderRequest): Promise<BatchOrderResponse> {
  if (!batchData.parent_id) throw new Error('Please sign in to continue.');
  if (!batchData.orders || batchData.orders.length === 0) throw new Error('Your cart is empty.');

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

  return invokeWithRetry<BatchOrderResponse>('process-batch-order', batchData);
}

// ══════════════════════════════════════════════════════════════
// Order History
// ══════════════════════════════════════════════════════════════

/**
 * Get paginated order history for a parent (daily orders).
 */
export async function getOrderHistory(parentId: string, page = 0) {
  const from = page * ORDER_PAGE_SIZE;
  const to = from + ORDER_PAGE_SIZE - 1;

  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      student:students!orders_student_id_fkey(id, first_name, last_name),
      items:order_items(
        *,
        product:products(name, image_url)
      )
    `)
    .eq('parent_id', parentId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw error;
  return data as OrderWithDetails[];
}

export { ORDER_PAGE_SIZE };