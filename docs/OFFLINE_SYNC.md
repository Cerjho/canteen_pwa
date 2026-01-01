# Offline Sync Strategy

## Overview

Parents can place orders offline. Orders are queued locally and synced when connectivity is restored.

---

## Architecture

```text
┌─────────────────────────────────────────────┐
│           User Places Order                  │
└──────────────┬──────────────────────────────┘
               │
       ┌───────▼────────┐
       │ Online?        │
       └───┬────────┬───┘
           │        │
       YES │        │ NO
           │        │
  ┌────────▼───┐  ┌▼──────────────────┐
  │ Send to    │  │ Queue in IndexedDB │
  │ Supabase   │  │ + Show "pending"   │
  └────────────┘  └─────────┬──────────┘
                            │
                   ┌────────▼─────────┐
                   │ Service Worker   │
                   │ detects online   │
                   └────────┬─────────┘
                            │
                   ┌────────▼─────────┐
                   │ Process queue    │
                   │ with retry logic │
                   └──────────────────┘
```

---

## IndexedDB Schema

### Database: `canteen-offline`

**Object Store**: `order-queue`

```typescript
interface QueuedOrder {
  // Local fields
  id: string;                    // UUID (local ID)
  queued_at: Date;
  retry_count: number;
  last_error: string | null;
  
  // Order data (matches API)
  client_order_id: string;       // Idempotency key
  parent_id: string;
  child_id: string;
  items: Array<{
    product_id: string;
    quantity: number;
    price_at_order: number;
  }>;
  payment_method: string;
  notes: string;
}
```

**Indexes**:

- `child_id` - Group orders by child
- `queued_at` - Process oldest first

---

## Queue Operations

### 1. Enqueue Order

```typescript
async function enqueueOrder(order: OrderRequest): Promise<void> {
  const queuedOrder: QueuedOrder = {
    id: crypto.randomUUID(),
    queued_at: new Date(),
    retry_count: 0,
    last_error: null,
    ...order
  };
  
  await db.put('order-queue', queuedOrder);
  
  // Request background sync
  if ('serviceWorker' in navigator && 'sync' in ServiceWorkerRegistration.prototype) {
    const registration = await navigator.serviceWorker.ready;
    await registration.sync.register('sync-orders');
  }
}
```

### 2. Process Queue

```typescript
async function processQueue(): Promise<void> {
  const queue = await db.getAll('order-queue');
  
  for (const order of queue) {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/process-order`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          parent_id: order.parent_id,
          child_id: order.child_id,
          client_order_id: order.client_order_id,
          items: order.items,
          payment_method: order.payment_method,
          notes: order.notes
        })
      });
      
      if (response.ok || response.status === 409) {
        // Success or duplicate (already processed)
        await db.delete('order-queue', order.id);
      } else {
        // Retry on server error
        await handleRetry(order);
      }
    } catch (error) {
      await handleRetry(order);
    }
  }
}
```

### 3. Retry Logic

```typescript
async function handleRetry(order: QueuedOrder): Promise<void> {
  const MAX_RETRIES = 5;
  
  if (order.retry_count >= MAX_RETRIES) {
    // Move to failed queue or notify user
    await db.delete('order-queue', order.id);
    await db.put('failed-orders', {
      ...order,
      failed_at: new Date(),
      reason: order.last_error
    });
    return;
  }
  
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s
  const backoffMs = Math.pow(2, order.retry_count) * 1000;
  
  await db.put('order-queue', {
    ...order,
    retry_count: order.retry_count + 1,
    last_error: 'Network error'
  });
  
  // Schedule retry
  setTimeout(() => processQueue(), backoffMs);
}
```

---

## Idempotency

### Client-Side

Every order gets a unique `client_order_id` (UUID v4) generated before queuing:

```typescript
const clientOrderId = crypto.randomUUID();
```

This ID remains the same across retries.

### Server-Side

Edge Function checks for duplicate `client_order_id`:

```sql
SELECT id FROM orders WHERE client_order_id = $1;
```

If exists, returns existing order with 409 status.

---

## Conflict Resolution

### Scenario 1: Stock Changed While Offline

**Problem**: User orders 5 items offline, but only 3 remain when syncing.

**Solution**:

1. Edge Function returns `INSUFFICIENT_STOCK` error
2. Frontend notifies user
3. User adjusts quantity or cancels

```typescript
if (response.status === 400 && data.error === 'INSUFFICIENT_STOCK') {
  showNotification({
    title: 'Stock Updated',
    message: `${data.product_name} only has ${data.available_quantity} left`,
    actions: ['Adjust Order', 'Cancel']
  });
}
```

### Scenario 2: Product Removed While Offline

**Problem**: User adds product offline, product discontinued when syncing.

**Solution**:

1. Edge Function returns `PRODUCT_UNAVAILABLE`
2. Order rejected
3. User notified to reorder

---

## Service Worker Integration

### Background Sync Event

```typescript
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-orders') {
    event.waitUntil(processQueue());
  }
});
```

### Periodic Sync (Optional)

For browsers supporting Periodic Background Sync:

```typescript
// Register periodic sync (once per hour)
const registration = await navigator.serviceWorker.ready;
await registration.periodicSync.register('sync-orders', {
  minInterval: 60 * 60 * 1000 // 1 hour
});

// Service worker
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'sync-orders') {
    event.waitUntil(processQueue());
  }
});
```

---

## UI Indicators

### Queue Status Badge

Show number of queued orders:

```tsx
<div className="queue-badge">
  {queuedCount > 0 && (
    <span className="badge badge-warning">
      {queuedCount} pending
    </span>
  )}
</div>
```

### Order Status

```tsx
<OrderCard>
  {order.status === 'queued' && (
    <div className="status status-pending">
      <CloudOff /> Queued (will sync when online)
    </div>
  )}
</OrderCard>
```

---

## Testing Offline Sync

### 1. Simulate Offline Mode

```javascript
// Chrome DevTools → Network → Offline
// Or in code:
if (import.meta.env.DEV) {
  window.__FORCE_OFFLINE__ = true;
}
```

### 2. Manual Test Flow

1. Go offline
2. Add items to cart
3. Place order (should queue)
4. Check IndexedDB (DevTools → Application → IndexedDB)
5. Go online
6. Verify order syncs automatically
7. Check order appears in history

### 3. Automated Test

```typescript
test('queues order when offline', async () => {
  // Mock offline
  global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));
  
  await placeOrder(mockOrder);
  
  const queue = await db.getAll('order-queue');
  expect(queue).toHaveLength(1);
  expect(queue[0].client_order_id).toBe(mockOrder.client_order_id);
});
```

---

## Edge Cases

### 1. User Logs Out While Orders Queued

**Solution**: Keep queue tied to `parent_id`, sync on next login.

### 2. Browser Cache Cleared

**Solution**: IndexedDB persists unless manually cleared. Warn users about losing queued orders.

### 3. Multiple Tabs Open

**Solution**: Use BroadcastChannel to sync queue state:

```typescript
const channel = new BroadcastChannel('order-queue');
channel.postMessage({ type: 'QUEUE_UPDATED' });
```

---

## Performance Considerations

- **Queue Size**: Limit to 100 orders per child
- **Batch Processing**: Process 10 orders at a time
- **Throttling**: Wait 1s between batch requests

---

## Monitoring

Log queue metrics:

```typescript
analytics.track('offline_order_queued', {
  child_id: order.child_id,
  items_count: order.items.length,
  total_amount: calculateTotal(order.items)
});

analytics.track('offline_order_synced', {
  queued_duration: Date.now() - order.queued_at.getTime(),
  retry_count: order.retry_count
});
```

---

## Future Enhancements

- [ ] Delta sync (only changed data)
- [ ] Optimistic UI updates
- [ ] Offline analytics
- [ ] Smart retry (retry during low network congestion)
