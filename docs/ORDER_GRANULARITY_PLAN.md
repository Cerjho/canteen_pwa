# Order Granularity Hardening & Enhancement Plan

## Summary

Five fixes rolled out incrementally across 4 phases. Each phase is a self-contained
migration + backend + frontend change that can be shipped and tested independently.

| Phase | What | Risk | Effort |
| ----- | ---- | ---- | ------ |
| 1 | DB safety: unique partial index + composite index | Low | Small |
| 2 | Partial fulfillment: per-item `status` column | Medium | Medium |
| 3 | Consolidate meal periods: one order per student+date | High | Large |
| 4 | Auto-merge: append items to existing orders | High | Large |

### Decisions Made

- **Auto-merge** (transparent) over explicit parent choice — less friction
- **`confirmed / unavailable`** item statuses only — no substitution for now
- **Incremental rollout** — each phase independently shippable and testable
- `orders.meal_period` kept as deprecated nullable column in Phase 3 — remove later
- Merge blocked for orders past `pending` status
- Unique partial index excludes `cancelled` orders

---

## Phase 1 — DB Safety (Unique Constraint + Composite Index)

> Prevent two active orders for the same student + date + meal_period slot.

### 1.1 Migration

**File**: `supabase/migrations/20260225_order_slot_uniqueness.sql`

```sql
-- Prevent duplicate active orders for the same slot
CREATE UNIQUE INDEX idx_unique_order_per_slot
  ON orders(student_id, scheduled_for, meal_period)
  WHERE status NOT IN ('cancelled');

-- Composite lookup index for fast slot queries
CREATE INDEX idx_orders_student_date_meal
  ON orders(student_id, scheduled_for, meal_period);
```

### 1.2 Schema Drift Fix

**File**: `supabase/consolidated_schema.sql`

- Backport `meal_period TEXT DEFAULT 'lunch'` to the `orders` table definition (~line 291)
- Backport `meal_period TEXT DEFAULT 'lunch'` to the `cart_items` table definition (~line 468)
- Add both new indexes to the indexes section (~line 546)

### 1.3 Edge Function Changes

Add a **pre-insert duplicate slot check** in all 4 order-creation edge functions,
right after the existing `client_order_id` idempotency check:

| File | Location |
| ---- | -------- |
| `supabase/functions/process-batch-order/index.ts` | After ~line 168 |
| `supabase/functions/create-batch-checkout/index.ts` | After ~line 232 |
| `supabase/functions/process-order/index.ts` | After ~line 408 |
| `supabase/functions/create-checkout/index.ts` | After ~line 231 |

Logic (same in all 4):

```typescript
// Check for existing active orders on the same (student_id, scheduled_for, meal_period)
const slotChecks = orders.map(o => ({
  student_id: o.student_id,
  scheduled_for: o.scheduled_for || todayStr,
  meal_period: o.meal_period || 'lunch',
}));

const { data: conflicting } = await supabaseAdmin
  .from('orders')
  .select('id, student_id, scheduled_for, meal_period')
  .in('student_id', [...new Set(slotChecks.map(s => s.student_id))])
  .in('scheduled_for', [...new Set(slotChecks.map(s => s.scheduled_for))])
  .not('status', 'eq', 'cancelled');

const conflicts = conflicting?.filter(existing =>
  slotChecks.some(s =>
    s.student_id === existing.student_id &&
    s.scheduled_for === existing.scheduled_for &&
    s.meal_period === existing.meal_period
  )
);

if (conflicts && conflicts.length > 0) {
  return errorResponse(corsHeaders, 409, 'DUPLICATE_SLOT',
    'An active order already exists for this student, date, and meal period.',
    { existing_order_ids: conflicts.map(c => c.id) }
  );
}
```

### 1.4 Frontend Changes

**No UI changes required.** The frontend already groups by `student_id × scheduled_for × meal_period`,
so duplicate submissions are already unlikely. The backend check is a safety net.

**Error handling** — add `DUPLICATE_SLOT` to the friendly error map:

| File | Change |
| ---- | ------ |
| `src/utils/friendlyError.ts` | Add mapping: `'DUPLICATE_SLOT' → 'An order already exists for this student and meal. Please modify the existing order instead.'` |
| `src/services/orders.ts` (~line 290) | Handle `DUPLICATE_SLOT` in `createBatchOrder` error handling |
| `src/services/payments.ts` (~line 145) | Handle `DUPLICATE_SLOT` in `createBatchCheckout` error handling |

### 1.5 Tests

| File | Test |
| ---- | ---- |
| `tests/unit/database/schema.test.ts` | Assert `idx_unique_order_per_slot` index exists |
| `tests/integration/orderWorkflow.test.ts` | Two orders for same slot → second returns `DUPLICATE_SLOT` |

---

## Phase 2 — Partial Fulfillment (Item-Level Status)

> Staff can mark individual items as unavailable, triggering partial stock
> restore and partial refund.

### 2.1 Migration

**File**: `supabase/migrations/20260225_order_item_status.sql`

```sql
ALTER TABLE order_items
  ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'
  CHECK (status IN ('confirmed', 'unavailable'));
```

Update `consolidated_schema.sql` `order_items` definition to include the column.

### 2.2 Backend: New Edge Function Action

**File**: `supabase/functions/manage-order/index.ts`

Add new action `mark-item-unavailable`:

```text
POST /manage-order
{
  "action": "mark-item-unavailable",
  "order_id": "uuid",
  "item_id": "uuid"
}
```

Logic:

1. Verify the order exists and is in `pending` or `preparing` status.
2. Verify the item belongs to the order and is currently `confirmed`.
3. Set `order_items.status = 'unavailable'`.
4. Call `increment_stock` RPC for `(item.product_id, item.quantity)`.
5. Recalculate `orders.total_amount` from remaining confirmed items:

   ```sql
   UPDATE orders SET total_amount = (
     SELECT COALESCE(SUM(price_at_order * quantity), 0)
     FROM order_items WHERE order_id = $1 AND status = 'confirmed'
   ) WHERE id = $1;
   ```

6. If the order was paid with `balance`, issue partial refund:
   - Call `credit_balance_with_payment` RPC for `item.price_at_order × item.quantity`.
7. If ALL items become `unavailable`, set `orders.status = 'cancelled'`.
8. Return updated order with item statuses.

### 2.3 Frontend: Types

**File**: `src/types/index.ts`

```diff
 export interface OrderItem {
   id: string;
   order_id: string;
   product_id: string;
   quantity: number;
   price_at_order: number;
+  status?: 'confirmed' | 'unavailable';
   created_at?: string;
 }
```

### 2.4 Frontend: Staff Dashboard — Item Unavailable Button

**File**: `src/pages/Staff/Dashboard.tsx`

**A) Add mutation function** (near `handleCancelOrder`, ~line 870):

```typescript
const markItemUnavailable = useCallback(async (orderId: string, itemId: string) => {
  const token = await ensureValidAccessToken();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-order`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'mark-item-unavailable', order_id: orderId, item_id: itemId }),
  });
  if (!res.ok) { /* error toast */ }
  queryClient.invalidateQueries({ queryKey: ['staff-orders'] });
}, []);
```

**B) Update order item rendering** (~line 1953–1971):

```diff
 {order.items.map((item) => (
-  <div key={item.id} className="flex justify-between py-1">
+  <div key={item.id} className={`flex justify-between py-1 ${
+    item.status === 'unavailable' ? 'opacity-50 line-through' : ''
+  }`}>
     <div className="flex items-center gap-2">
       {item.product.image_url && <img src={item.product.image_url} ... />}
       <span className="text-sm">{item.product.name}</span>
+      {item.status === 'unavailable' && (
+        <span className="text-xs text-red-500 font-medium">Unavailable</span>
+      )}
     </div>
-    <span className="font-medium text-sm">x{item.quantity}</span>
+    <div className="flex items-center gap-2">
+      <span className="font-medium text-sm">x{item.quantity}</span>
+      {item.status === 'confirmed' &&
+       (order.status === 'pending' || order.status === 'preparing') && (
+        <button
+          onClick={() => markItemUnavailable(order.id, item.id)}
+          className="text-red-400 hover:text-red-600 p-1"
+          title="Mark unavailable"
+        >
+          <XCircleIcon className="w-4 h-4" />
+        </button>
+      )}
+    </div>
   </div>
 ))}
```

**C) Update order total display** — show adjusted total if any items are unavailable:

```tsx
{order.items.some(i => i.status === 'unavailable') && (
  <span className="text-xs text-amber-600">
    (adjusted from ₱{originalTotal.toFixed(2)})
  </span>
)}
```

### 2.5 Frontend: Parent Order History — Show Unavailable Items

**File**: `src/pages/Parent/OrderHistory.tsx`

In the items list rendering, strike-through unavailable items and show a note:

```tsx
{item.status === 'unavailable' && (
  <span className="text-xs text-red-500">Unavailable — refunded</span>
)}
```

### 2.6 Frontend: Parent Dashboard — Active Orders

**File**: `src/pages/Parent/Dashboard.tsx`

Same visual treatment as OrderHistory for active order items — strike-through
unavailable items with a "refunded" label.

### 2.7 Frontend: Hook

**File**: `src/hooks/useOrders.ts`

Add mutation:

```typescript
const markItemUnavailable = useMutation({
  mutationFn: async ({ orderId, itemId }: { orderId: string; itemId: string }) => {
    const { data } = await supabase.functions.invoke('manage-order', {
      body: { action: 'mark-item-unavailable', order_id: orderId, item_id: itemId },
    });
    return data;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['order-history'] });
  },
});
```

### 2.8 Tests

| File | Test |
| ---- | ---- |
| `tests/unit/services/processOrder.test.ts` | Mock `mark-item-unavailable` response |
| `tests/integration/orderWorkflow.test.ts` | Mark item unavailable → verify stock restored, total recalculated, wallet credited |
| `tests/integration/orderWorkflow.test.ts` | Mark ALL items unavailable → order auto-cancelled |

---

## Phase 3 — Consolidate Meal Periods (One Order per Student+Date)

> Move `meal_period` from `orders` to `order_items`. All items for the same
> student+date go into one order regardless of meal period.

### 3.1 Migration

**File**: `supabase/migrations/20260225_consolidate_meal_period.sql`

```sql
-- 1. Add meal_period to order_items
ALTER TABLE order_items
  ADD COLUMN meal_period TEXT DEFAULT 'lunch'
  CHECK (meal_period IN ('morning_snack', 'lunch', 'afternoon_snack'));

-- 2. Backfill from parent order
UPDATE order_items oi
  SET meal_period = COALESCE(o.meal_period, 'lunch')
  FROM orders o
  WHERE oi.order_id = o.id;

-- 3. Replace unique index: (student, date, meal_period) → (student, date)
DROP INDEX IF EXISTS idx_unique_order_per_slot;
CREATE UNIQUE INDEX idx_unique_order_per_student_date
  ON orders(student_id, scheduled_for)
  WHERE status NOT IN ('cancelled');

-- 4. Replace composite index
DROP INDEX IF EXISTS idx_orders_student_date_meal;
CREATE INDEX idx_orders_student_date
  ON orders(student_id, scheduled_for);

-- 5. Deprecate orders.meal_period (keep nullable for backward compat)
COMMENT ON COLUMN orders.meal_period IS 'DEPRECATED: Use order_items.meal_period instead';
```

Update `consolidated_schema.sql`:

- Add `meal_period` column to `order_items` definition
- Add `COMMENT` on `orders.meal_period`
- Update index definitions

### 3.2 Backend: Edge Function Changes

All 4 edge functions need the same structural change:

#### Grouping key change

| File | Old key | New key |
| ---- | ------- | ------- |
| `process-batch-order/index.ts` | `(student_id, scheduled_for, meal_period)` | `(student_id, scheduled_for)` |
| `create-batch-checkout/index.ts` | same | same |
| `process-order/index.ts` | N/A (single order) | N/A |
| `create-checkout/index.ts` | N/A (single order) | N/A |

#### Request interface change

The `OrderGroup` interface in each edge function changes:

```diff
 interface OrderGroup {
   student_id: string;
   client_order_id: string;
-  items: OrderItem[];
+  items: OrderItemInput[];   // now includes meal_period per item
   scheduled_for?: string;
-  meal_period?: string;      // removed from order level
 }

+interface OrderItemInput {
+  product_id: string;
+  quantity: number;
+  price_at_order: number;
+  meal_period?: string;      // moved to item level
+}
```

#### Order row insert change

```diff
 const orderRows = orders.map(order => ({
   parent_id,
   student_id: order.student_id,
   client_order_id: order.client_order_id,
   status: orderStatus,
   // ...
-  meal_period: order.meal_period || 'lunch',
+  meal_period: null,  // deprecated, kept for backward compat
 }));
```

#### Order items insert change

```diff
 const allOrderItems = orders.flatMap(order => {
   const dbOrderId = orderIdMap.get(order.client_order_id);
   return order.items.map(item => ({
     order_id: dbOrderId,
     product_id: item.product_id,
     quantity: item.quantity,
     price_at_order: item.price_at_order,
+    meal_period: item.meal_period || 'lunch',
   }));
 });
```

#### Duplicate slot check change

```diff
-// Check (student_id, scheduled_for, meal_period)
+// Check (student_id, scheduled_for) only
 const conflicts = conflicting?.filter(existing =>
   slotChecks.some(s =>
     s.student_id === existing.student_id &&
-    s.scheduled_for === existing.scheduled_for &&
-    s.meal_period === existing.meal_period
+    s.scheduled_for === existing.scheduled_for
   )
 );
```

### 3.3 Frontend: Types

**File**: `src/types/index.ts`

```diff
 export interface Order {
   // ...
-  meal_period?: MealPeriod;
+  /** @deprecated Use items[].meal_period instead */
+  meal_period?: MealPeriod;
 }

 export interface OrderItem {
   id: string;
   order_id: string;
   product_id: string;
   quantity: number;
   price_at_order: number;
   status?: 'confirmed' | 'unavailable';
+  meal_period?: MealPeriod;
   created_at?: string;
 }
```

**File**: `src/services/orders.ts`

```diff
 export interface BatchOrderGroup {
   student_id: string;
   client_order_id: string;
-  items: Array<{ product_id: string; quantity: number; price_at_order: number }>;
+  items: Array<{
+    product_id: string;
+    quantity: number;
+    price_at_order: number;
+    meal_period?: string;
+  }>;
   scheduled_for?: string;
-  meal_period?: string;
 }
```

**File**: `src/services/payments.ts`

Same change to `BatchCheckoutOrderGroup` and `CheckoutOrderGroup` — move
`meal_period` into items array, remove from order level.

### 3.4 Frontend: useCart.ts — Grouping Key Change

**File**: `src/hooks/useCart.ts`

**A) Change grouping key** (~line 790):

```diff
-const key = `${item.student_id}_${item.scheduled_for}_${item.meal_period}`;
+const key = `${item.student_id}_${item.scheduled_for}`;
```

Change the `Map` value type:

```diff
-const groups = new Map<string, {
-  student_id: string; scheduled_for: string; meal_period: MealPeriod; items: CartItem[]
-}>();
+const groups = new Map<string, {
+  student_id: string; scheduled_for: string; items: CartItem[]
+}>();
```

**B) Change batch order building** (~line 830):

```diff
 const batchOrders = groupsArray.map(group => ({
   student_id: group.student_id,
   client_order_id: crypto.randomUUID(),
   items: group.items.map(item => ({
     product_id: item.product_id,
     quantity: item.quantity,
-    price_at_order: item.price
+    price_at_order: item.price,
+    meal_period: item.meal_period,  // per-item now
   })),
   scheduled_for: group.scheduled_for,
-  meal_period: group.meal_period,
 }));
```

**C) Change `orderCount` in `CartSummary`** (~line 319):

```diff
-const orderCombinations = new Set(
-  items.map(i => `${i.student_id}_${i.scheduled_for}_${i.meal_period}`)
-);
+const orderCombinations = new Set(
+  items.map(i => `${i.student_id}_${i.scheduled_for}`)
+);
```

**D) Change cart clearing logic** — match items by `student_id_scheduled_for`
instead of `student_id_scheduled_for_meal_period`.

**E) Update return value** (~line 854):

```diff
 return {
   redirecting: true,
   orders: batchResult.order_ids.map((oid, i) => ({
     order_id: oid,
     checkout_url: batchResult.checkout_url,
     student_id: groupsArray[i]?.student_id || '',
     scheduled_for: groupsArray[i]?.scheduled_for || '',
-    meal_period: groupsArray[i]?.meal_period || 'lunch' as MealPeriod,
   })),
   total, successCount, failCount: 0
 };
```

### 3.5 Frontend: CartDrawer.tsx — Order Group Count

**File**: `src/components/CartDrawer.tsx`

**A) Update `orderGroupCount`** (~line 67):

```diff
 const orderGroupCount = (() => {
   const keys = new Set<string>();
   const activeItems = selectedDates.size > 0 ? items.filter(...) : items;
   for (const item of activeItems) {
-    keys.add(`${item.student_id}_${item.scheduled_for}_${item.meal_period}`);
+    keys.add(`${item.student_id}_${item.scheduled_for}`);
   }
   return keys.size;
 })();
```

**B) Item rendering** — No change needed. Meal period badges are already shown
per item, not per group.

### 3.6 Frontend: Staff Dashboard — Kitchen View

**File**: `src/pages/Staff/Dashboard.tsx`

**A) Kitchen prep grouping** (~line 387–460):

Change from `order.meal_period` to iterating `order.items` and using
`item.meal_period`:

```diff
 orders.filter(o => o.status === 'pending' || o.status === 'preparing')
   .forEach(order => {
     const gradeLevel = order.child?.grade_level || 'Unknown';
-    const mealPeriod: MealPeriod = order.meal_period || 'lunch';
     order.items.forEach(item => {
+      const mealPeriod: MealPeriod = item.meal_period || 'lunch';
       // ... aggregate into grade → meal → product structure
     });
   });
```

**B) Order card** — Add per-item meal period badge in the items list:

```diff
 {order.items.map((item) => (
   <div key={item.id} className={`flex justify-between py-1 ...`}>
     <div className="flex items-center gap-2">
       <span className="text-sm">{item.product.name}</span>
+      {item.meal_period && (
+        <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 rounded">
+          {MEAL_PERIOD_ICONS[item.meal_period]} {MEAL_PERIOD_LABELS[item.meal_period]}
+        </span>
+      )}
     </div>
     ...
   </div>
 ))}
```

**C) Remove per-order meal period badge** from the order card header (if displayed).

**D) Update `StaffOrder` interface** (~line 50):

```diff
 interface StaffOrder {
   // ...
-  meal_period?: MealPeriod;
+  /** @deprecated */
+  meal_period?: MealPeriod;
   items: (OrderItem & {
     product: { name: string; image_url?: string };
+    meal_period?: MealPeriod;
   })[];
 }
```

**E) Update the order fetch query** (~line 212) to include `meal_period` from `order_items`:

```diff
 items:order_items(
-  *, product:products(name, image_url)
+  *, meal_period, product:products(name, image_url)
 )
```

### 3.7 Frontend: Parent Order History — Flatten Groups

**File**: `src/pages/Parent/OrderHistory.tsx`

The current grouping logic (~line 155) groups orders by `student_id × scheduled_for`
and renders sub-orders split by meal period. After Phase 3, there's only **one order
per student+date**, so:

**A) Simplify grouping** — each "group" now has exactly one order:

```diff
 const groups = new Map<string, { ... orders: OrderWithDetails[], ... }>();
 for (const order of orders) {
-  const key = `${child?.id}_${order.scheduled_for}`;
+  // Each order is already one-per-student-date; group key matches 1:1
+  const key = order.id;
   // ...
 }
```

Or keep the existing grouping logic (it still works — it'll just have 1 order per group).

**B) Replace per-order meal period sections** with per-item meal period badges:

```diff
-{/* Meal period sections */}
-{group.orders.map(order => (
-  <div key={order.id}>
-    <span>{MEAL_PERIOD_ICONS[order.meal_period]} {MEAL_PERIOD_LABELS[order.meal_period]}</span>
-    {order.items.map(item => ...)}
-  </div>
-))}
+{/* Single order, items grouped by meal period */}
+{group.orders[0]?.items
+  .sort((a, b) => mealSort[a.meal_period || 'lunch'] - mealSort[b.meal_period || 'lunch'])
+  .map(item => (
+    <div key={item.id} className="flex justify-between py-1">
+      <div className="flex items-center gap-2">
+        <span>{item.product.name}</span>
+        <span className="text-xs">{MEAL_PERIOD_ICONS[item.meal_period]}</span>
+      </div>
+      <span>x{item.quantity} — ₱{(item.price_at_order * item.quantity).toFixed(2)}</span>
+    </div>
+  ))}
```

### 3.8 Frontend: Parent Dashboard — Active Orders

**File**: `src/pages/Parent/Dashboard.tsx`

Same pattern as OrderHistory — show meal period badges per item instead of per order.
Update any `order.meal_period` references (~lines 63, 274, 423, 616–618) to use
`item.meal_period` from the items array.

### 3.9 Frontend: localQueue.ts — Offline Queue

**File**: `src/services/localQueue.ts`

Update `QueuedOrder` interface to carry `meal_period` per item instead of per order:

```diff
 interface QueuedOrder {
   // ...
-  meal_period?: string;
+  items: Array<{
+    product_id: string;
+    quantity: number;
+    price_at_order: number;
+    meal_period?: string;
+  }>;
 }
```

### 3.10 Tests

| File | What to update |
| ---- | -------------- |
| `tests/unit/database/schema.test.ts` | Assert `meal_period` column on `order_items`, new unique index name |
| `tests/integration/orderWorkflow.test.ts` | Update grouping assertions — one order per student+date even with mixed meal periods |
| `tests/integration/workflows.test.ts` | Update cart grouping expectations |

---

## Phase 4 — Auto-Merge into Existing Order

> When a parent checks out for a student+date that already has an active pending
> order, the system transparently appends items to the existing order instead of
> failing with `DUPLICATE_SLOT`.

### 4.1 Migration

**File**: `supabase/migrations/20260225_order_auto_merge.sql`

No schema changes required. The unique index from Phase 3 stays — the edge functions
merge into existing orders instead of violating the constraint.

Optional: add an `updated_at` trigger so merged orders show a fresh timestamp:

```sql
-- Ensure updated_at refreshes on any UPDATE to orders
CREATE OR REPLACE FUNCTION update_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_orders_updated_at();
```

### 4.2 Backend: Edge Function Merge Logic

**Files**: All 4 edge functions

Replace the `DUPLICATE_SLOT` error response with **merge mode**:

#### `process-batch-order/index.ts` and `create-batch-checkout/index.ts`

```typescript
// Instead of returning 409 DUPLICATE_SLOT...
// For each conflict, check if the existing order is mergeable
const mergeableStatuses = ['pending', 'awaiting_payment'];

for (const conflict of conflicts) {
  if (!mergeableStatuses.includes(conflict.status)) {
    return errorResponse(corsHeaders, 409, 'ORDER_LOCKED',
      `Order for this student and date is already ${conflict.status}. Cannot add items.`,
      { order_id: conflict.id, status: conflict.status }
    );
  }
}

// Enter merge mode: append items to existing orders
const mergedOrderIds: string[] = [];
const newOrderGroups: OrderGroup[] = [];

for (const order of orders) {
  const existingOrder = conflicts.find(c =>
    c.student_id === order.student_id &&
    c.scheduled_for === (order.scheduled_for || todayStr)
  );

  if (existingOrder) {
    // MERGE: append items to existing order
    const newItems = order.items.map(item => ({
      order_id: existingOrder.id,
      product_id: item.product_id,
      quantity: item.quantity,
      price_at_order: item.price_at_order,
      meal_period: item.meal_period || 'lunch',
    }));

    const { error: itemsErr } = await supabaseAdmin
      .from('order_items').insert(newItems);

    if (itemsErr) { /* rollback */ }

    // Recalculate total
    const { data: allItems } = await supabaseAdmin
      .from('order_items')
      .select('price_at_order, quantity')
      .eq('order_id', existingOrder.id)
      .eq('status', 'confirmed');

    const newTotal = allItems!.reduce((s, i) => s + i.price_at_order * i.quantity, 0);

    await supabaseAdmin.from('orders')
      .update({ total_amount: newTotal })
      .eq('id', existingOrder.id);

    // Handle payment delta
    const delta = order.items.reduce((s, i) => s + i.price_at_order * i.quantity, 0);
    // For balance: deduct delta from wallet
    // For cash: update pending payment amount

    mergedOrderIds.push(existingOrder.id);
  } else {
    newOrderGroups.push(order);  // No conflict, create normally
  }
}

// Create any non-conflicting orders normally (existing insert logic)
// ...

// Response includes merge info
return new Response(JSON.stringify({
  success: true,
  order_ids: [...mergedOrderIds, ...newlyCreatedIds],
  merged_order_ids: mergedOrderIds,
  new_order_ids: newlyCreatedIds,
  merged: mergedOrderIds.length > 0,
  total_amount: grandTotal,
}));
```

#### `process-order/index.ts` and `create-checkout/index.ts` (legacy single-order)

Same logic but for a single order — check if `(student_id, scheduled_for)` has
an existing active order, and if so, append items to it.

### 4.3 Frontend: Types

**File**: `src/types/index.ts`

```diff
 export interface BatchOrderResponse {
   success: boolean;
   order_ids: string[];
+  merged_order_ids?: string[];
+  new_order_ids?: string[];
+  merged?: boolean;
   total_amount: number;
 }

+export interface BatchCheckoutResponse {
+  // ...existing fields...
+  merged?: boolean;
+  merged_order_ids?: string[];
+}
```

### 4.4 Frontend: useCart.ts — Handle Merge Response

**File**: `src/hooks/useCart.ts`

After the batch order call returns (~line 900):

```diff
 const batchResult = await createBatchOrder(batchData);

+// Notify parent if items were merged into existing orders
+if (batchResult.merged) {
+  // Use a different success message
+  toast.success(
+    `Items added to ${batchResult.merged_order_ids!.length} existing order(s)`,
+    { duration: 4000 }
+  );
+}
```

Similarly for online payments (~line 840):

```diff
 const batchResult = await createBatchCheckout(checkoutData);
+// If merge happened, the checkout URL covers only the delta amount
```

### 4.5 Frontend: CartDrawer.tsx — "Adding to Existing Order" Indicator

**File**: `src/components/CartDrawer.tsx`

When the cart has items for a student+date that already has an active order,
show a subtle indicator:

**A) Accept `existingOrders` prop**:

```diff
 interface CartDrawerProps {
   // ...existing props...
+  existingOrders?: Array<{ student_id: string; scheduled_for: string; order_id: string }>;
 }
```

**B) Show indicator per date group**:

```tsx
{existingOrders?.some(o =>
  o.student_id === item.student_id &&
  o.scheduled_for === item.scheduled_for
) && (
  <div className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 rounded px-2 py-0.5">
    <PlusCircleIcon className="w-3 h-3" />
    Will be added to existing order
  </div>
)}
```

**C) Pass the prop from Menu.tsx**:

**File**: `src/pages/Parent/Menu.tsx`

Query active orders for the current parent's students and pass them to
`CartDrawer`:

```typescript
const { data: activeOrders } = useQuery({
  queryKey: ['active-orders-for-cart'],
  queryFn: async () => {
    const { data } = await supabase
      .from('orders')
      .select('id, student_id, scheduled_for')
      .eq('parent_id', user.id)
      .not('status', 'in', '("cancelled","completed")')
    return data || [];
  },
  enabled: cartOpen,
});

<CartDrawer
  // ...existing props...
  existingOrders={activeOrders}
/>
```

### 4.6 Frontend: Menu.tsx — Success Message

**File**: `src/pages/Parent/Menu.tsx`

Update `handleCheckout` (~line 240) to pass merge info to the confirmation page:

```diff
 navigate('/order-confirmation', {
   state: {
     orderId: result?.orders?.[0]?.order_id || crypto.randomUUID(),
     orderCount: result?.orders?.length || 1,
     totalAmount: checkoutTotal,
+    merged: result?.merged || false,
+    mergedCount: result?.merged_order_ids?.length || 0,
     // ...rest
   }
 });
```

### 4.7 Frontend: OrderConfirmation.tsx — Merge Message

**File**: `src/pages/Parent/OrderConfirmation.tsx`

```diff
 interface OrderConfirmationState {
   // ...existing fields...
+  merged?: boolean;
+  mergedCount?: number;
 }

 // In the success rendering:
+{state.merged && (
+  <p className="text-blue-600 text-sm mt-2">
+    Items were added to {state.mergedCount} existing order(s)
+  </p>
+)}
```

### 4.8 Frontend: Services — Handle Merge Response

**File**: `src/services/orders.ts`

Update `BatchOrderResponse` and `createBatchOrder` to pass through merge flags:

```diff
 export interface BatchOrderResponse {
   success: boolean;
   order_ids: string[];
+  merged_order_ids?: string[];
+  merged?: boolean;
   total_amount: number;
 }
```

**File**: `src/services/payments.ts`

Same for `createBatchCheckout` response handling.

### 4.9 Backend: Cancel & Cleanup Updates

**File**: `supabase/functions/parent-cancel-order/index.ts`

No change needed — cancelling an order restores stock for ALL its items,
including merged ones.

**File**: `supabase/functions/cleanup-timeout-orders/index.ts`

No change needed — timed-out orders cancel all their items regardless of
whether they were merged.

### 4.10 Tests

| File | Test |
| ---- | ---- |
| `tests/unit/services/orders.test.ts` | Mock `merged: true` response from `createBatchOrder` |
| `tests/integration/orderWorkflow.test.ts` | Place order for student+date, then place another → items merged, total updated |
| `tests/integration/orderWorkflow.test.ts` | Merge into `preparing` order → returns `ORDER_LOCKED` |
| `tests/integration/orderWorkflow.test.ts` | Merge with balance payment → delta deducted from wallet |
| `tests/integration/orderWorkflow.test.ts` | Cancel a merged order → all items restored, full refund |

---

## Files Changed Per Phase — Summary

### Phase 1 (DB Safety)

| File | Type |
| ---- | ---- |
| `supabase/migrations/20260225_order_slot_uniqueness.sql` | **New** |
| `supabase/consolidated_schema.sql` | Edit |
| `supabase/functions/process-batch-order/index.ts` | Edit |
| `supabase/functions/create-batch-checkout/index.ts` | Edit |
| `supabase/functions/process-order/index.ts` | Edit |
| `supabase/functions/create-checkout/index.ts` | Edit |
| `src/utils/friendlyError.ts` | Edit |
| `src/services/orders.ts` | Edit |
| `src/services/payments.ts` | Edit |
| `tests/unit/database/schema.test.ts` | Edit |
| `tests/integration/orderWorkflow.test.ts` | Edit |

### Phase 2 (Partial Fulfillment)

| File | Type |
| ---- | ---- |
| `supabase/migrations/20260225_order_item_status.sql` | **New** |
| `supabase/consolidated_schema.sql` | Edit |
| `supabase/functions/manage-order/index.ts` | Edit |
| `src/types/index.ts` | Edit |
| `src/hooks/useOrders.ts` | Edit |
| `src/pages/Staff/Dashboard.tsx` | Edit |
| `src/pages/Parent/OrderHistory.tsx` | Edit |
| `src/pages/Parent/Dashboard.tsx` | Edit |
| `tests/unit/services/processOrder.test.ts` | Edit |
| `tests/integration/orderWorkflow.test.ts` | Edit |

### Phase 3 (Consolidate Meal Periods)

| File | Type |
| ---- | ---- |
| `supabase/migrations/20260225_consolidate_meal_period.sql` | **New** |
| `supabase/consolidated_schema.sql` | Edit |
| `supabase/functions/process-batch-order/index.ts` | Edit |
| `supabase/functions/create-batch-checkout/index.ts` | Edit |
| `supabase/functions/process-order/index.ts` | Edit |
| `supabase/functions/create-checkout/index.ts` | Edit |
| `src/types/index.ts` | Edit |
| `src/services/orders.ts` | Edit |
| `src/services/payments.ts` | Edit |
| `src/services/localQueue.ts` | Edit |
| `src/hooks/useCart.ts` | Edit |
| `src/components/CartDrawer.tsx` | Edit |
| `src/pages/Staff/Dashboard.tsx` | Edit |
| `src/pages/Parent/OrderHistory.tsx` | Edit |
| `src/pages/Parent/Dashboard.tsx` | Edit |
| `tests/unit/database/schema.test.ts` | Edit |
| `tests/integration/orderWorkflow.test.ts` | Edit |
| `tests/integration/workflows.test.ts` | Edit |

### Phase 4 (Auto-Merge)

| File | Type |
| ---- | ---- |
| `supabase/migrations/20260225_order_auto_merge.sql` | **New** (optional trigger) |
| `supabase/functions/process-batch-order/index.ts` | Edit |
| `supabase/functions/create-batch-checkout/index.ts` | Edit |
| `supabase/functions/process-order/index.ts` | Edit |
| `supabase/functions/create-checkout/index.ts` | Edit |
| `src/types/index.ts` | Edit |
| `src/services/orders.ts` | Edit |
| `src/services/payments.ts` | Edit |
| `src/hooks/useCart.ts` | Edit |
| `src/components/CartDrawer.tsx` | Edit |
| `src/pages/Parent/Menu.tsx` | Edit |
| `src/pages/Parent/OrderConfirmation.tsx` | Edit |
| `tests/unit/services/orders.test.ts` | Edit |
| `tests/integration/orderWorkflow.test.ts` | Edit |

---

## Verification Checklist

### Phase 1

- [ ] Attempt to create two orders for same student+date+meal_period → second fails with `409 DUPLICATE_SLOT`
- [ ] Cancelled order for slot → can place a new one
- [ ] Existing tests pass with no regressions

### Phase 2

- [ ] Staff marks item unavailable on a balance-paid order → stock restored, wallet credited, total recalculated
- [ ] Staff marks ALL items unavailable → order auto-cancels
- [ ] Unavailable items shown strike-through in staff and parent views
- [ ] Cannot mark items unavailable on `ready` or `completed` orders

### Phase 3

- [ ] Parent adds lunch main + afternoon snack for same student/date → creates ONE order
- [ ] Order items each carry correct `meal_period`
- [ ] Staff kitchen view groups by `item.meal_period` correctly
- [ ] Parent OrderHistory shows meal badges per item
- [ ] Existing orders with `orders.meal_period` still render correctly (backward compat)

### Phase 4

- [ ] Parent places order, then adds more items for same student+date → items merged into existing order
- [ ] Merge with balance → delta deducted
- [ ] Merge with cash → pending payment amount updated
- [ ] Merge blocked when order is `preparing` or later → returns `ORDER_LOCKED`
- [ ] CartDrawer shows "Will be added to existing order" indicator
- [ ] OrderConfirmation shows "Items added to X existing order(s)" message
- [ ] Cancel a merged order → all items stock-restored, full refund
