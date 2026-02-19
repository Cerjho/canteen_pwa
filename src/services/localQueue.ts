import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { supabase } from './supabaseClient';

interface QueuedOrder {
  id: string;
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
  queued_at: Date;
  retry_count: number;
  last_error?: string;
}

interface CanteenDB extends DBSchema {
  'order-queue': {
    key: string;
    value: QueuedOrder;
    indexes: { 'by-student': string; 'by-queued': Date };
  };
}

// Use promise-based singleton to prevent race conditions
let dbPromise: Promise<IDBPDatabase<CanteenDB>> | null = null;

async function getDB(): Promise<IDBPDatabase<CanteenDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CanteenDB>('canteen-offline', 2, {
      upgrade(database, oldVersion) {
        // Delete old store if upgrading from v1
        if (oldVersion < 2 && database.objectStoreNames.contains('order-queue')) {
          database.deleteObjectStore('order-queue');
        }
        if (!database.objectStoreNames.contains('order-queue')) {
          const store = database.createObjectStore('order-queue', {
            keyPath: 'id'
          });
          store.createIndex('by-student', 'student_id');
          store.createIndex('by-queued', 'queued_at');
        }
      }
    });
  }

  return dbPromise;
}

export function isOnline(): boolean {
  return navigator.onLine;
}

export async function queueOrder(orderData: Omit<QueuedOrder, 'id' | 'queued_at' | 'retry_count'>) {
  // Validate required fields
  if (!orderData.parent_id || !orderData.student_id || !orderData.items?.length) {
    throw new Error('Invalid order data: missing required fields (parent_id, student_id, or items)');
  }
  
  if (orderData.items.some(item => !item.product_id || item.quantity <= 0)) {
    throw new Error('Invalid order item: product_id required and quantity must be positive');
  }

  const database = await getDB();
  
  const queuedOrder: QueuedOrder = {
    ...orderData,
    id: crypto.randomUUID(),
    queued_at: new Date(),
    retry_count: 0
  };

  await database.add('order-queue', queuedOrder);
  
  // Request background sync if available
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    try {
      const registration = await navigator.serviceWorker.ready;
      // Use type assertion for Background Sync API (not yet in TypeScript lib)
      interface SyncManager {
        register(tag: string): Promise<void>;
      }
      interface ServiceWorkerRegistrationWithSync extends ServiceWorkerRegistration {
        sync: SyncManager;
      }
      await (registration as ServiceWorkerRegistrationWithSync).sync.register('sync-orders');
    } catch (error) {
      // console.warn('Background sync registration failed:', error);
    }
  }
}

export async function getQueuedOrders(): Promise<QueuedOrder[]> {
  const database = await getDB();
  return database.getAll('order-queue');
}

export async function removeQueuedOrder(id: string): Promise<void> {
  const database = await getDB();
  await database.delete('order-queue', id);
}

export async function incrementRetryCount(id: string): Promise<void> {
  const database = await getDB();
  const order = await database.get('order-queue', id);
  
  if (order) {
    order.retry_count += 1;
    await database.put('order-queue', order);
  }
}

export async function updateOrderError(id: string, error: string): Promise<void> {
  const database = await getDB();
  const order = await database.get('order-queue', id);
  
  if (order) {
    order.last_error = error;
    await database.put('order-queue', order);
  }
}

// Exponential backoff delay calculation
function getBackoffDelay(retryCount: number): number {
  const baseDelay = 1000; // 1 second
  const maxDelay = 30000; // 30 seconds
  const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
  // Add jitter to prevent thundering herd
  return delay + Math.random() * 1000;
}

// Concurrency guard to prevent double-processing
let isProcessing = false;

// Process queue when online
export async function processQueue(): Promise<{ processed: number; failed: number }> {
  if (!isOnline() || isProcessing) {
    return { processed: 0, failed: 0 };
  }

  isProcessing = true;
  try {

  const orders = await getQueuedOrders();
  let processed = 0;
  let failed = 0;
  
  // Get auth token from Supabase session
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session) {
    // console.warn('No active session, cannot process queue');
    return { processed: 0, failed: orders.length };
  }

  for (const order of orders) {
    try {
      // Apply backoff delay if this is a retry
      if (order.retry_count > 0) {
        const delay = getBackoffDelay(order.retry_count);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // Call Supabase Edge Function to process order
      const { data, error } = await supabase.functions.invoke('process-order', {
        body: {
          parent_id: order.parent_id,
          student_id: order.student_id,
          client_order_id: order.client_order_id,
          items: order.items,
          payment_method: order.payment_method,
          notes: order.notes,
          scheduled_for: order.scheduled_for
        }
      });

      if (error) {
        throw error;
      }

      // Check for specific error codes in response
      if (data?.error) {
        if (data.error === 'DUPLICATE_ORDER') {
          // Order already exists - this is fine, remove from queue
        // Order already processed (dedupe check)
        if (import.meta.env.DEV) {
          // console.log('Order already processed (duplicate):', order.client_order_id);
        }
          await removeQueuedOrder(order.id);
          processed++;
          continue;
        }

        if (data.error === 'INSUFFICIENT_STOCK') {
          // Stock issue - notify user and remove from queue
          // console.warn('Order failed due to insufficient stock:', data.message);
          await updateOrderError(order.id, data.message);
          
          // Move to failed queue after notifying
          await moveToFailedQueue(order, data.message);
          await removeQueuedOrder(order.id);
          failed++;
          continue;
        }

        throw new Error(data.message || 'Unknown error');
      }

      // Success - remove from queue
      if (import.meta.env.DEV) {
        // console.log('Order processed successfully:', data.order_id);
      }
      await removeQueuedOrder(order.id);
      processed++;

    } catch (error) {
      // console.error('Failed to process order:', order.id, error);
      
      // Update error message
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await updateOrderError(order.id, errorMessage);
      
      // Increment retry count
      await incrementRetryCount(order.id);
      
      // Check if max retries exceeded
      const updatedOrder = await (await getDB()).get('order-queue', order.id);
      if (updatedOrder && updatedOrder.retry_count >= MAX_RETRIES) {
        // console.warn('Max retries exceeded, moving to failed queue:', order.id);
        await moveToFailedQueue(updatedOrder, 'Max retries exceeded');
        await removeQueuedOrder(order.id);
        failed++;
      }
    }
  }

  return { processed, failed };
  } finally {
    isProcessing = false;
  }
}

const MAX_RETRIES = 5;

// Move order to failed queue for user review
async function moveToFailedQueue(order: QueuedOrder, reason: string): Promise<void> {
  // Store failed orders in localStorage for now
  // In production, could use another IndexedDB store
  const failedOrders = JSON.parse(localStorage.getItem('failed-orders') || '[]');
  // Limit failed queue to prevent unbounded localStorage growth
  const MAX_FAILED_ORDERS = 20;
  if (failedOrders.length >= MAX_FAILED_ORDERS) {
    failedOrders.shift(); // Remove oldest
  }
  failedOrders.push({
    ...order,
    failed_at: new Date().toISOString(),
    failure_reason: reason
  });
  localStorage.setItem('failed-orders', JSON.stringify(failedOrders));

  // Dispatch event for UI notification
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('order-failed', {
      detail: { order, reason }
    }));
  }
}

// Get failed orders for user review
export function getFailedOrders(): Array<QueuedOrder & { failed_at: string; failure_reason: string }> {
  return JSON.parse(localStorage.getItem('failed-orders') || '[]');
}

// Clear failed orders
export function clearFailedOrders(): void {
  localStorage.removeItem('failed-orders');
}

// Retry a specific failed order
export async function retryFailedOrder(clientOrderId: string): Promise<void> {
  const failedOrders = getFailedOrders();
  const orderToRetry = failedOrders.find(o => o.client_order_id === clientOrderId);
  
  if (orderToRetry) {
    // Re-queue the order
    await queueOrder({
      parent_id: orderToRetry.parent_id,
      student_id: orderToRetry.student_id,
      client_order_id: orderToRetry.client_order_id, // Keep same ID for idempotency
      items: orderToRetry.items,
      payment_method: orderToRetry.payment_method,
      notes: orderToRetry.notes,
      scheduled_for: orderToRetry.scheduled_for
    });

    // Remove from failed queue
    const updatedFailed = failedOrders.filter(o => o.client_order_id !== clientOrderId);
    localStorage.setItem('failed-orders', JSON.stringify(updatedFailed));
  }
}

// Listen for online event
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (import.meta.env.DEV) {
      // console.log('Back online, processing queue...');
    }
    processQueue()
      .then(({ processed: _processed, failed: _failed }) => {
        if (import.meta.env.DEV) {
          // console.log(`Queue processed: ${_processed} successful, ${_failed} failed`);
        }
      })
      .catch((_error) => {
        // console.error('Failed to process queue on reconnect:', _error);
      });
  });
}
