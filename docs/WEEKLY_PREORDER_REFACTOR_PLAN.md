# Loheca Canteen — Weekly Pre-Order Refactor Plan

> **Date**: March 4, 2026  
> **Status**: Planning  
> **Scope**: Full system refactor — database, edge functions, frontend, tests, docs

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Business Rules](#2-business-rules)
3. [Current State vs Target State](#3-current-state-vs-target-state)
4. [Phase 1 — Delete & Remove](#phase-1--delete--remove)
5. [Phase 2 — Database Schema Changes](#phase-2--database-schema-changes)
6. [Phase 3 — Edge Function Refactor](#phase-3--edge-function-refactor)
7. [Phase 4 — Frontend Types & Services](#phase-4--frontend-types--services)
8. [Phase 5 — Frontend Hooks](#phase-5--frontend-hooks)
9. [Phase 6 — Frontend Components](#phase-6--frontend-components)
10. [Phase 7 — Frontend Pages (Parent)](#phase-7--frontend-pages-parent)
11. [Phase 8 — Frontend Pages (Staff)](#phase-8--frontend-pages-staff)
12. [Phase 9 — Frontend Pages (Admin)](#phase-9--frontend-pages-admin)
13. [Phase 10 — Utilities](#phase-10--utilities)
14. [Phase 11 — Deprecated Code Cleanup](#phase-11--deprecated-code-cleanup)
15. [Phase 12 — Test Cleanup & New Tests](#phase-12--test-cleanup--new-tests)
16. [Phase 13 — Documentation Updates](#phase-13--documentation-updates)
17. [Verification Checklist](#verification-checklist)
18. [Key Decisions](#key-decisions)

---

## 1. Executive Summary

Transform the Loheca Canteen PWA from a **generic anytime-ordering canteen** to a **strict weekly pre-ordering system**. Three goals in one refactor:

1. **Weekly Pre-Ordering** — Parents order for the entire next week (Mon–Fri) before Friday 5 PM cutoff. No late orders except surplus ("sobra") items marked by staff, accepted until 8 AM same day. Per-day cancellation allowed until 8 AM (e.g., student absent).

2. **Remove Wallet/Balance System** — Loheca doesn't use prepaid wallets. Remaining payment methods: cash, gcash, paymaya, card.

3. **Codebase Cleanup** — Remove stock/inventory tracking (canteen prepares based on order count), delete unnecessary edge functions, purge all deprecated code, update all documentation.

---

## 2. Business Rules

### Weekly Pre-Ordering

| Rule | Detail |

|------|--------|
| **Ordering window** | Open until **Friday 5:00 PM** (Manila TZ) for the **following week** (Mon–Fri) |
| **Menu per day** | Different menu items per day — admin assigns products to each weekday |
| **Menu publishing** | Admin publishes next week's menu → parents can then order |
| **Payment** | Pay for the entire week at once (single payment for Mon–Fri) |
| **No late orders** | "Pahabol" is **not allowed** during operational hours |
| **Surplus exception** | If there is surplus food ("sobra"), staff can either: (a) mark items as surplus → parents order via app, OR (b) accept walk-ins and record in system. **Until 8:00 AM only** |
| **Cancellation** | No cancellation of the entire weekly order after submission. But can cancel **individual days** (e.g., student is sick) — only until **8:00 AM** of that day |
| **No inventory/stock** | Canteen prepares food based on order count — no stock limits |
| **Meal periods** | Keep morning_snack, lunch, afternoon_snack per item |
| **Reporting** | Weekly-based (not daily) |

### Ordering Timeline Example

``` text
Week of Feb 23–27 (ordering window):
  Mon Feb 23 → Admin publishes menu for Mar 2–6
  Tue–Fri   → Parents browse next week's menu, build weekly cart
  Fri 5:00 PM → CUTOFF — orders locked for Mar 2–6

Week of Mar 2–6 (fulfillment):
  Each morning → Staff sees today's pre-orders as kitchen prep list
  Before 8 AM  → Parents can cancel individual days (e.g., child sick on Wed)
  Before 8 AM  → If surplus food exists, staff marks items → parents/walk-ins can order
  8:00 AM      → Surplus ordering + day cancellation locked
  Throughout day → Staff fulfills orders: pending → preparing → ready → completed
```

---

## 3. Current State vs Target State

| Aspect | Current | Target |

|--------|---------|--------|
| **Ordering model** | Daily — order for any open date, anytime | Weekly — order Mon–Fri of next week, before Fri 5 PM |
| **Order entity** | One `orders` row per student per date | `weekly_orders` parent + 5 `orders` children (one per day) |
| **Menu view** | Current week's remaining days | Next week's full menu (Mon–Fri) |
| **Cutoff** | Soft daily cutoff at 10:00 AM (not enforced in edge functions) | Hard weekly cutoff at Friday 5:00 PM (DB trigger + edge function) |
| **Late orders** | Any open date, anytime | Only surplus items, until 8 AM, staff-initiated |
| **Cancellation** | Full order cancel while pending | Individual day cancel until 8 AM of that day |
| **Payment** | Per-order (can batch at checkout) | Per-week (single payment for all 5 days) |
| **Wallet/balance** | Yes — prepaid wallet with top-up | **Removed** — cash + online only |
| **Stock tracking** | Yes — `stock_quantity` per product, `decrement_stock` | **Removed** — prepare based on order count |
| **Payment methods** | cash, balance, gcash, paymaya, card | cash, gcash, paymaya, card |
| **Reporting** | Daily-based with weekly aggregates | Weekly-first with daily breakdown |
| **Staff view** | Today's orders, real-time incoming | Today's pre-orders (kitchen prep list), surplus management |

---

## Phase 1 — Delete & Remove

### Files to DELETE Entirely

| # | File / Directory | Reason |

|---|---|---|
| 1 | `src/components/TopUpModal.tsx` | Wallet top-up UI |
| 2 | `src/pages/Parent/Balance.tsx` | Wallet/balance page |
| 3 | `supabase/functions/admin-topup/` (entire dir) | Admin wallet credit edge function |
| 4 | `supabase/functions/create-topup-checkout/` (entire dir) | PayMongo top-up checkout flow |
| 5 | `supabase/functions/process-order/` (entire dir) | Single-order function — superseded by batch/weekly |
| 6 | `tests/unit/services/balanceConcurrency.test.ts` | Tests for removed wallet concurrency |
| 7 | `tests/unit/components/TopUpModal.test.ts` | Tests for removed TopUpModal |
| 8 | `e2e/concurrency.spec.ts` | E2E tests for balance race conditions (all skipped) |

### DB Objects to DROP (via new migration)

| Object | Type | Reason |

|--------|------|--------|
| `wallets` | TABLE | Wallet removed |
| All 6 `wallets` RLS policies | POLICY | Wallet removed |
| `topup_sessions` | TABLE | Top-up removed |
| `deduct_balance_with_payment()` | FUNCTION | Wallet removed |
| `credit_balance_with_payment()` | FUNCTION | Wallet removed |
| `increment_stock()` | FUNCTION | Stock tracking removed |
| `decrement_stock()` | FUNCTION | Stock tracking removed |
| `products.stock_quantity` | COLUMN | Stock tracking removed |
| `validate_cart_item_max_advance()` | TRIGGER FUNC | Replaced by weekly cutoff |
| `order_cutoff_time` setting | SETTING | Replaced by `weekly_cutoff_time` |
| `max_future_days` setting | SETTING | Replaced by weekly cutoff |
| `low_stock_threshold` setting | SETTING | Stock tracking removed |
| `orders.meal_period` | COLUMN | Deprecated — already on `order_items` |
| `get_todays_menu()` | FUNCTION | Replaced by week-based menu queries |

---

## Phase 2 — Database Schema Changes

### 2.1 New `weekly_orders` Table

```sql
CREATE TABLE weekly_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES auth.users(id),
  student_id UUID NOT NULL REFERENCES students(id),
  week_start DATE NOT NULL, -- Monday of target week
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'active', 'completed', 'cancelled')),
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('cash', 'gcash', 'paymaya', 'card')),
  payment_status TEXT DEFAULT 'awaiting_payment'
    CHECK (payment_status IN ('awaiting_payment', 'paid', 'timeout', 'refunded', 'failed')),
  paymongo_checkout_id TEXT,
  paymongo_checkout_url TEXT,
  paymongo_payment_intent_id TEXT,
  payment_group_id UUID,
  payment_due_at TIMESTAMPTZ,
  notes TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (student_id, week_start)
);
```

### 2.2 Modify `orders` Table

```sql
ALTER TABLE orders
  ADD COLUMN weekly_order_id UUID REFERENCES weekly_orders(id),
  ADD COLUMN order_type TEXT NOT NULL DEFAULT 'pre_order'
    CHECK (order_type IN ('pre_order', 'surplus', 'walk_in'));

-- Drop deprecated column
ALTER TABLE orders DROP COLUMN meal_period;
```

### 2.3 New `surplus_items` Table

```sql
CREATE TABLE surplus_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  scheduled_date DATE NOT NULL DEFAULT CURRENT_DATE,
  meal_period TEXT CHECK (meal_period IN ('morning_snack', 'lunch', 'afternoon_snack')),
  marked_by UUID NOT NULL REFERENCES auth.users(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (product_id, scheduled_date, meal_period)
);
```

### 2.4 Updated System Settings

| Setting | Value | Description |

|---------|-------|-------------|
| `weekly_cutoff_day` | `'friday'` | Day of week when ordering closes |
| `weekly_cutoff_time` | `'17:00'` | Time on cutoff day (5 PM) |
| `surplus_cutoff_time` | `'08:00'` | Daily deadline for surplus orders |
| `daily_cancel_cutoff_time` | `'08:00'` | Daily deadline for day cancellation |

**Remove**: `order_cutoff_time`, `max_future_days`, `low_stock_threshold`

### 2.5 New DB Triggers & Functions

| Function | Purpose |

|----------|---------|
| `validate_weekly_order_cutoff()` | Trigger on `weekly_orders` INSERT — blocks creation after Friday 5 PM for target week |
| `validate_surplus_order_cutoff()` | Trigger on `orders` INSERT where `order_type = 'surplus'` — blocks after 8 AM |
| `validate_daily_cancellation()` | RPC — validates cancellation is before 8 AM of target date |
| `get_weekly_order_summary(week_start DATE)` | RPC — aggregated counts per product per day for kitchen prep |
| `get_weekly_report(week_start DATE)` | RPC — weekly revenue, order counts, per-student summaries |

**Modify**: `validate_cart_item_date()` → target NEXT week's Mon–Fri dates

### 2.6 Data Migration

```sql
-- Backfill existing orders into weekly grouping
INSERT INTO weekly_orders (parent_id, student_id, week_start, status, total_amount, payment_method, payment_status, submitted_at)
SELECT
  parent_id, student_id,
  date_trunc('week', scheduled_for)::DATE AS week_start,
  'completed', SUM(total_amount), MIN(payment_method), 'paid', MIN(created_at)
FROM orders
WHERE status NOT IN ('cancelled')
GROUP BY parent_id, student_id, date_trunc('week', scheduled_for);

-- Link existing orders to their weekly_order
UPDATE orders o SET weekly_order_id = wo.id
FROM weekly_orders wo
WHERE o.parent_id = wo.parent_id
  AND o.student_id = wo.student_id
  AND date_trunc('week', o.scheduled_for)::DATE = wo.week_start;

-- Set order_type for existing data
UPDATE orders SET order_type = 'pre_order' WHERE order_type IS NULL;

-- Drop stock column
ALTER TABLE products DROP COLUMN stock_quantity;
```

---

## Phase 3 — Edge Function Refactor

### 3.1 Functions to DELETE

| Function | Reason |

|----------|--------|
| `admin-topup/` | Wallet removed |
| `create-topup-checkout/` | Wallet removed |
| `process-order/` | Superseded by batch/weekly flow |

### 3.2 Functions to CREATE

| Function | Purpose |

|----------|---------|
| `process-weekly-order` | Accept full week's order: `{ student_id, week_start, items[], payment_method }`. Create `weekly_orders` + 5 `orders` + `order_items`. Validate cutoff. No stock logic. |
| `create-weekly-checkout` | PayMongo checkout session for entire week's total, referencing `weekly_order_id` |
| `process-surplus-order` | Accept surplus order for today's items only (until 8 AM). Create `order` with `order_type = 'surplus'`. Validate surplus cutoff + item in `surplus_items` |
| `staff-place-order` | Staff places walk-in surplus order on behalf of parent. Creates `order` with `order_type = 'walk_in'` |

### 3.3 Functions to MODIFY

| Function | Changes |

|----------|---------|
| `process-batch-order` | Remove balance validation + `deduct_balance_with_payment`. Remove `decrement_stock`. Refactor to support weekly order creation. May be **replaced** by `process-weekly-order` |
| `create-batch-checkout` | Remove stock decrement. May be **replaced** by `create-weekly-checkout` |
| `create-checkout` | Remove stock decrement. Keep for surplus single-day online payments only, or remove if surplus uses batch |
| `check-payment-status` | Remove entire topup session branch (~150 lines at L200–353) |
| `paymongo-webhook` | Remove `handleTopupPaymentPaid` function + topup session DB lookups |
| `parent-cancel-order` | Change from "cancel entire order" to "cancel specific day from weekly order". Validate daily 8 AM cutoff. Recalculate `weekly_orders.total_amount`. Remove `credit_balance_with_payment` |
| `refund-order` | Remove balance refund (`credit_balance_with_payment`). Online → refund via PayMongo. Cash → just cancel |
| `manage-order` | Add surplus item marking. Add weekly order queries. Keep daily status transitions |
| `manage-settings` | Add `weekly_cutoff_*`, `surplus_cutoff_time`, `daily_cancel_cutoff_time`. Remove deprecated settings |
| `staff-product` | Remove stock update actions. Add surplus item marking interface |
| `manage-product` | Remove `update-stock` action |
| `cleanup-timeout-orders` | Handle `weekly_orders` payment timeouts |
| `confirm-cash-payment` | Handle `weekly_orders` cash confirmation |
| `_shared/paymongo.ts` | Remove topup URL builder (~17 lines) |

### 3.4 Functions to KEEP (No Changes)

`create-user`, `link-student`, `list-staff`, `manage-calendar`, `manage-menu`, `manage-profile`, `manage-student`, `notify`, `register`, `retry-checkout`, `send-invites`, `update-dietary`, `verify-invitation`

---

## Phase 4 — Frontend Types & Services

### 4.1 Types — `src/types/index.ts`

**Remove**:

- `'balance'` from `PaymentMethod` union → becomes `'cash' | 'gcash' | 'paymaya' | 'card'`
- `Parent.balance` field
- `CreateTopupCheckoutResponse` type
- `PaymentStatusResponse.topup_session_id`
- `Product.stock_quantity` field
- Deprecated `Child` interface (use `Student`)
- Deprecated `Transaction` interface (use `Payment + PaymentAllocation`)
- Deprecated `Order.meal_period` field

**Add**:

```typescript
export type OrderType = 'pre_order' | 'surplus' | 'walk_in';
export type WeeklyOrderStatus = 'submitted' | 'active' | 'completed' | 'cancelled';

export interface WeeklyOrder {
  id: string;
  parent_id: string;
  student_id: string;
  week_start: string; // YYYY-MM-DD (Monday)
  status: WeeklyOrderStatus;
  total_amount: number;
  payment_method: PaymentMethod;
  payment_status?: string;
  paymongo_checkout_url?: string;
  payment_due_at?: string;
  notes?: string;
  submitted_at?: string;
  created_at: string;
  updated_at: string;
  // Joined data
  student?: Student;
  daily_orders?: Order[];
}

export interface SurplusItem {
  id: string;
  product_id: string;
  scheduled_date: string;
  meal_period?: MealPeriod;
  marked_by: string;
  is_active: boolean;
  created_at: string;
  product?: Product;
}
```

**Modify**:

```typescript
export interface Order {
  // ... existing fields ...
  weekly_order_id?: string;
  order_type?: OrderType;
}
```

### 4.2 Order Service — `src/services/orders.ts`

**Remove**: `createOrder()` (single — use weekly only), `'balance'` from payment methods

**Add**:

| Function | Purpose |

|----------|---------|
| `createWeeklyOrder(req)` | Calls `process-weekly-order` edge function |
| `createSurplusOrder(req)` | Calls `process-surplus-order` edge function |
| `cancelDayFromWeeklyOrder(weeklyOrderId, date)` | Calls updated `parent-cancel-order` |
| `getWeeklyOrders(parentId, page)` | Paginated weekly order history |
| `getWeeklyOrderDetail(weeklyOrderId)` | Single weekly order with daily breakdown |

### 4.3 Product Service — `src/services/products.ts`

**Remove**: All stock-related queries/logic

**Add**:

| Function | Purpose |

|----------|---------|
| `getMenuForWeek(weekStart)` | Returns all products for Mon–Fri of target week |
| `getNextOrderableWeek()` | Determines which week parents should order for (based on cutoff) |
| `getSurplusItems()` | Fetch active surplus items for today |

### 4.4 Payment Service — `src/services/payments.ts`

**Remove**: `createTopupCheckout()`, `checkTopupStatus()`, `'balance'` cases in helpers

**Add**: `createWeeklyCheckout(weeklyOrderId)` — PayMongo session for entire week

### 4.5 Student Service — `src/services/students.ts`

**Remove**: Deprecated `getChildren()`, old update methods

### 4.6 Error Utilities — `src/utils/friendlyError.ts`

**Remove**: "Insufficient balance" error pattern

**Add**: Error messages for:

- "Weekly cutoff has passed — orders for next week are closed"
- "Surplus ordering is closed (past 8:00 AM)"
- "Cannot cancel — past 8:00 AM cancellation deadline"
- "Menu not yet published for this week"

---

## Phase 5 — Frontend Hooks

### 5.1 `useCart.ts` — Major Refactor → Weekly Order Builder

**Current**: Cart stores items per student × date, no cutoff enforcement, has balance/stock checks

**Target**:

- `selectedWeek` state — auto-determined from cutoff (before Fri 5 PM → next week; after → week after)
- `addItem(productId, date, mealPeriod, qty)` — add to specific day within the week
- `removeItem(productId, date, mealPeriod)` — remove from specific day
- `copyDayItems(fromDate, toDate)` — keep existing feature
- `getWeekTotal()` — total across all 5 days
- `getDayTotal(date)` — subtotal for one day
- `submitWeeklyOrder()` — calls `createWeeklyOrder`, validates cutoff
- Remove: stock validation, balance checks, `'balance'` payment method

### 5.2 `useOrders.ts`

**Add**:

- `useWeeklyOrders(parentId)` — fetch weekly orders grouped by week
- `useWeeklyOrderDetail(weeklyOrderId)` — single weekly order with daily breakdown
- `useTodaysPreOrders()` — for staff: today's daily orders from weekly pre-orders

### 5.3 `useProducts.ts`

**Add**:

- `useWeekMenu(weekStart)` — fetch entire week's menu
- `useSurplusItems()` — fetch today's surplus items

**Remove**: stock-related queries

### 5.4 `useSystemSettings.ts`

**Add**: New settings (`weekly_cutoff_day`, `weekly_cutoff_time`, `surplus_cutoff_time`, `daily_cancel_cutoff_time`) + helpers:

- `isCutoffPassed(targetWeek)` — boolean
- `getCutoffCountdown()` — `{ days, hours, minutes }`

### 5.5 `useStudents.ts`

**Remove**: Deprecated `useStudents` alias

---

## Phase 6 — Frontend Components

### 6.1 Components to DELETE

| Component | Reason |

|-----------|--------|
| `TopUpModal.tsx` | Wallet removed |

### 6.2 Components to CREATE

| Component | Purpose |

|-----------|---------|
| `CutoffCountdown.tsx` | Countdown timer to Friday 5 PM. States: "Open for ordering", "Closing soon" (< 24h), "Closed" |
| `SurplusItemCard.tsx` | Product card variant for surplus items. "Available until 8 AM" badge. Quick add-to-order |
| `DayCancellationModal.tsx` | Parent selects day(s) to cancel from weekly order. Shows refund per day. Validates 8 AM cutoff |

### 6.3 Components to MODIFY

| Component | Changes |

|-----------|---------|
| `WeeklyCartSummary.tsx` | **Major refactor** — becomes primary weekly order builder summary. Mon–Fri with items per day grouped by meal period. Daily subtotals + weekly total. "Submit Weekly Order" CTA with cutoff countdown |
| `CartBottomSheet.tsx` | Full weekly cart with day tabs/accordion. Weekly total + payment method. "Submit Weekly Order" blocked after cutoff |
| `PaymentMethodSelector.tsx` | Remove `'balance'` / `'Wallet Balance'` option and balance-checking props |
| `ProductCard.tsx` | Remove stock badge / "out of stock" states |
| `ActiveOrderBadge.tsx` | Show weekly order status instead of daily |
| `OfflineIndicator.tsx` | Ensure offline queue works with weekly orders |

---

## Phase 7 — Frontend Pages (Parent)

### 7.1 `App.tsx`

- Remove `/balance` route + lazy import of `Balance.tsx`

### 7.2 `Menu.tsx` — Major Refactor

**Current**: Shows current week's remaining days, daily date selector, canteen open/close status

**Target**:

- Default view: **Next week's menu** (Mon–Fri tabs across top)
- Cutoff countdown banner ("Orders close in 2d 3h 15m")
- After cutoff: "Orders closed for next week" → option to view surplus items
- Day tabs show that day's items grouped by meal period (morning snack → lunch → afternoon snack)
- Quantity controls per item per day
- Bottom bar: "View Weekly Cart" with running weekly total
- Separate surplus section: today's surplus items (available until 8 AM)
- Remove: canteen open/close status for ordering

### 7.3 `Dashboard.tsx` — Major Refactor

**Current**: Daily order focus, wallet balance display, refund-to-wallet messaging

**Target**:

- Upcoming weekly order summary (next week's order if submitted)
- Today's meals for each student
- Cutoff countdown widget + quick "Order for next week" action
- Per-day cancellation button (before 8 AM of that day)
- Weekly order history (past weeks)
- Remove: wallet balance display, refund-to-wallet messaging

### 7.4 `OrderHistory.tsx` — Refactor

- Group by week (expandable to daily breakdown)
- Weekly totals, payment status
- Show cancelled days within a week

### 7.5 `OrderConfirmation.tsx` — Update

- Weekly order confirmation (Mon–Fri breakdown)
- Remove: topup/balance references

### 7.6 `Profile.tsx` — Update

- Remove entire "Wallet" section (balance display + link to `/balance`)

---

## Phase 8 — Frontend Pages (Staff)

### 8.1 `Staff/Dashboard.tsx` — Major Refactor

**Current**: Real-time incoming orders, daily operations, balance payment styling

**Target**:

- **Primary view**: Today's pre-orders as kitchen prep list
  - Group by: meal period → product → count per grade/section
  - Prep summary: "Today you need: 45 Chicken Adobo, 30 Spaghetti..."
- Order fulfillment: transition daily orders (pending → preparing → ready → completed)
- **Surplus management section**:
  - "Mark Surplus" button → select items with remaining portions
  - View incoming surplus orders
  - "Place walk-in order" for parents who come directly
- Weekly overview tab: all orders for current week at a glance
- Remove: `'balance'` payment method styling

### 8.2 `Staff/Products.tsx` — Update

- Remove stock quantity management
- Add surplus marking interface

---

## Phase 9 — Frontend Pages (Admin)

### 9.1 `Admin/WeeklyMenu.tsx` — Refactor

**Add "Publish Menu" workflow**:

- Status flow: Draft → Published → Locked (after cutoff)
- Admin must publish next week's menu before parents can order
- Prevent editing published menus (or warn about existing orders)
- Timeline: Admin publishes menu (ideally by Wed/Thu) → Parents order → Cutoff Fri 5 PM

### 9.2 `Admin/Reports.tsx` — Refactor

- Weekly-first reporting (not daily)
- Week selector instead of date range
- Metrics: weekly revenue, orders per student, popular items per week, cancellation rate, surplus order stats
- Per-day breakdown within the week
- Export: weekly summary PDF/CSV
- Remove: `'balance'` / `'topup'` payment type references

### 9.3 `Admin/Dashboard.tsx` — Refactor

- This week's order summary (total orders, revenue, students)
- Next week's order status (orders received vs students enrolled)
- Cutoff countdown
- Daily prep summary for current week

### 9.4 `Admin/Orders.tsx` — Refactor

- Filter by week (primary), then by day within week
- Weekly order view with expand-to-daily detail
- Surplus order section

### 9.5 `Admin/Settings.tsx` — Update

**Add**: Weekly cutoff config (day + time), surplus cutoff time, daily cancel cutoff time

**Remove**: Daily `order_cutoff_time`, `max_future_days`, `low_stock_threshold`

### 9.6 `Admin/Products.tsx` — Update

- Remove stock quantity field from product CRUD

### 9.7 `Admin/Users.tsx` — Update

- Remove inline TopUpModal, admin-topup mutation, wallet balance display

---

## Phase 10 — Utilities

### 10.1 `src/utils/dateUtils.ts` — Expand

**Currently**: Only `formatDateLocal()` and `getTodayLocal()` (both Manila TZ)

**Add**:

| Function | Purpose |

|----------|---------|
| `getNextOrderableWeek()` | Returns Monday of the week parents should order for. Before Fri 5 PM → next week's Monday. After Fri 5 PM → the Monday two weeks out |
| `getWeekDates(weekStart: string)` | Returns array of Mon–Fri date strings for given week |
| `getWeeklyCutoffDeadline(targetWeekStart: string)` | Returns Fri 5 PM `Date` of the week BEFORE the target week |
| `isCutoffPassed(targetWeekStart: string)` | Boolean — is current time past the cutoff for this week? |
| `getCutoffCountdown(targetWeekStart: string)` | Returns `{ days, hours, minutes, seconds }` until cutoff |
| `isSurplusCutoffPassed()` | Boolean — is current Manila time past 8 AM today? |
| `isDailyCancelCutoffPassed(date: string)` | Boolean — is current time past 8 AM of given date? |
| `getWeekLabel(weekStart: string)` | Formatted label: "Mar 2–6, 2026" |
| `getWeekNumber(date: string)` | ISO week number for grouping |

---

## Phase 11 — Deprecated Code Cleanup

All deprecated markers and their associated code should be removed:

| Item | Location | Action |

|------|----------|--------|
| `Child` interface | `src/types/index.ts` L40 | DELETE — use `Student` |
| `Transaction` interface | `src/types/index.ts` L145 | DELETE — use `Payment + PaymentAllocation` |
| `Order.meal_period` field | `src/types/index.ts` L127 | DELETE — use `items[].meal_period` |
| `orders.meal_period` column | `consolidated_schema.sql` L558 | DROP via migration |
| `getChildren()` + old updates | `src/services/students.ts` | DELETE deprecated functions |
| `useStudents` alias | `src/hooks/useStudents.ts` L23 | DELETE |
| `meal_period` at order level | Edge functions (process-order, create-checkout, etc.) | Remove from request schemas |
| Children mock data | `tests/mocks/data.ts` L119 | DELETE deprecated mock |
| `CreateOrderRequest` deprecated field | `src/types/index.ts` L264 | DELETE |

---

## Phase 12 — Test Cleanup & New Tests

### 12.1 Test Files to DELETE

| File | Reason |

|------|--------|
| `tests/unit/services/balanceConcurrency.test.ts` (178 lines) | Entirely about wallet balance concurrency |
| `tests/unit/components/TopUpModal.test.ts` (242 lines) | Tests for removed TopUpModal |
| `e2e/concurrency.spec.ts` (268 lines) | E2E for balance race conditions (all tests already skipped) |

### 12.2 Test Files to MODIFY — Remove Wallet/Balance/Stock References

| File | Lines | What to Update |

|------|-------|----------------|
| `tests/mocks/data.ts` | 365 | Remove `stock_quantity` from `mockProducts`, remove `balance: 500` from `mockParent`, remove deprecated `mockChildren` |
| `tests/unit/services/processOrder.test.ts` | 449 | Remove `describe('balance errors')` block, remove `describe('stock errors')` block, update payment to `'cash'` |
| `tests/unit/services/validation.test.ts` | 309 | Remove `describe('Stock Validation')` block, remove `describe('Balance Validation')` block |
| `tests/unit/services/paymentTypes.test.ts` | 244 | Remove `'balance'` from valid methods, remove `CreateTopupCheckoutResponse` refs |
| `tests/unit/services/products.test.ts` | 414 | Remove `stock_quantity` from expected select columns |
| `tests/unit/services/payments.test.ts` | 455 | Remove `createTopupCheckout` tests |
| `tests/unit/services/orders.test.ts` | 196 | Remove `'balance'` from valid payment methods |
| `tests/unit/services/cashPaymentFlow.test.ts` | 359 | Remove any `'balance'` references |
| `tests/unit/pages/Profile.test.tsx` | 445 | Remove wallet balance mock queries |
| `tests/unit/pages/OrderConfirmation.test.ts` | 278 | Remove `'balance'` label, topup URL params |
| `tests/unit/pages/Menu.test.tsx` | 718 | Remove `stock_quantity` from mock products |
| `tests/unit/pages/StaffDashboard.test.ts` | 566 | Remove `payment_method: 'balance'` mocks, balance filter test |
| `tests/unit/pages/DashboardPayment.test.ts` | 167 | Remove balance payment badge test |
| `tests/unit/hooks/useCartPayment.test.ts` | 230 | Remove `balance` from payment routing tests |
| `tests/unit/hooks/useProducts.test.tsx` | 233 | Remove `stock_quantity` from mocks |
| `tests/unit/components/PaymentMethodSelector.test.ts` | 139 | Remove `'balance'` from school methods |
| `tests/unit/components/WeeklyCartSummary.test.tsx` | 378 | Verify alignment with new weekly model |
| `tests/integration/orderWorkflow.test.ts` | 326 | Remove `describe('Balance Payment Flow')` block |

### 12.3 Tests to VERIFY Alignment (likely need updating for weekly model)

| File | Lines | Current Focus |

|------|-------|---------------|
| `tests/unit/hooks/useCart.test.ts` | 602 | Cart CRUD — may need weekly order builder updates |
| `tests/unit/hooks/useCart.multiday.test.ts` | 657 | Multi-day cart — may need weekly cutoff logic |
| `tests/unit/components/WeeklyCartSummary.test.tsx` | 378 | Weekly summary — verify matches new behavior |
| `tests/unit/pages/WeeklyMenu.test.ts` | 450 | Admin weekly menu — add publish/lock flow tests |

### 12.4 New Tests to WRITE

#### Unit Tests

| Test File | Tests |

|-----------|-------|
| `tests/unit/utils/dateUtils.test.ts` | `getNextOrderableWeek()`, `isCutoffPassed()`, `getCutoffCountdown()`, `isSurplusCutoffPassed()`, `isDailyCancelCutoffPassed()`, `getWeekDates()`, `getWeekLabel()` — all with Manila TZ edge cases |
| `tests/unit/hooks/useCart.weekly.test.ts` | Weekly cart builder: add items to specific days, week total calculation, cutoff enforcement, submit weekly order |
| `tests/unit/hooks/useOrders.weekly.test.ts` | `useWeeklyOrders()`, `useWeeklyOrderDetail()` — React Query integration |
| `tests/unit/services/weeklyOrders.test.ts` | `createWeeklyOrder()`, `createSurplusOrder()`, `cancelDayFromWeeklyOrder()` — edge function calls |
| `tests/unit/components/CutoffCountdown.test.tsx` | Countdown display states: open, closing soon, closed |
| `tests/unit/components/SurplusItemCard.test.tsx` | Surplus item rendering, 8 AM badge, add action |
| `tests/unit/components/DayCancellationModal.test.tsx` | Day selection, refund display, 8 AM validation |
| `tests/unit/database/weeklySchema.test.ts` | `weekly_orders` constraints, `surplus_items` constraints, cutoff trigger |

#### Integration Tests

| Test File | Tests |

|-----------|-------|
| `tests/integration/weeklyOrderWorkflow.test.ts` | Full lifecycle: create weekly order → pay → daily fulfill → complete |
| `tests/integration/surplusWorkflow.test.ts` | Staff marks surplus → parent orders before 8 AM (success) → rejected after 8 AM |
| `tests/integration/dayCancellation.test.ts` | Cancel day before 8 AM (success) → after 8 AM (rejected) → verify weekly total recalculated |
| `tests/integration/cutoffEnforcement.test.ts` | Order before Fri 5 PM (success) → after Fri 5 PM (rejected) |

#### E2E Tests

| Test File | Tests |

|-----------|-------|
| `e2e/weeklyOrdering.spec.ts` | Parent creates weekly order, pays, sees confirmation |
| `e2e/surplusFlow.spec.ts` | Staff marks surplus → parent orders via app |
| `e2e/cutoff.spec.ts` | Cutoff enforcement scenarios |

---

## Phase 13 — Documentation Updates

### 13.1 Docs Needing MAJOR Rewrite

| File | Lines | Changes |

|------|-------|---------|
| `docs/ARCHITECTURE.md` | 209 | Rewrite flow diagrams for weekly ordering. Remove "atomic stock" mention. Remove "wallet refund" from cleanup-timeout. Add weekly order entity, surplus flow |
| `docs/DATA_SCHEMA.md` | 325 | Add `weekly_orders`, `surplus_items` tables. Remove `wallets`, `topup_sessions`. Remove `stock_quantity` from products. Update `orders` with new columns. Remove deprecated `transactions` |
| `docs/API.md` | 588 | Remove `admin-topup`, `create-topup-checkout`, `process-order` endpoints. Add `process-weekly-order`, `create-weekly-checkout`, `process-surplus-order`, `staff-place-order`. Update modified endpoints. Remove `child_id` references |
| `docs/PAYMENT_INTEGRATION_DESIGN.md` | 1532 | Remove entire wallet/balance sections (self-service top-up, balance payment flow, admin manual top-up). Update payment methods to cash/gcash/paymaya/card only. Add weekly payment flow |
| `docs/ORDER_GRANULARITY_PLAN.md` | 1123 | Mark as **SUPERSEDED**. Add banner: "This plan has been superseded by the Weekly Pre-Order Refactor. See WEEKLY_PREORDER_REFACTOR_PLAN.md" |
| `docs/COPILOT_PROMPT.md` | 350 | Rewrite system description: weekly pre-ordering, no wallet, no stock. Update business rules. Update ordering flow |
| `docs/ROADMAP.md` | 172 | Update with weekly ordering milestones. Remove wallet top-up and recurring orders. Add surplus management, weekly reporting |

### 13.2 Docs Needing MODERATE Updates

| File | Lines | Changes |

|------|-------|---------|
| `docs/COMPONENTS.md` | 367 | Remove TopUpModal. Add CutoffCountdown, SurplusItemCard, DayCancellationModal. Update WeeklyCartSummary, CartBottomSheet descriptions |
| `docs/OFFLINE_SYNC.md` | 384 | Update queue schema for weekly orders (remove `child_id`). Describe offline weekly order behavior |
| `docs/SUPABASE_RLS.md` | 410 | Remove wallet RLS policies. Add `weekly_orders` and `surplus_items` RLS policies |
| `docs/TESTING.md` | 366 | Update test patterns for weekly ordering. Correct framework references (Vitest not Jest). Add new test file descriptions |
| `docs/CHANGELOG.md` | 132 | Add entry for weekly pre-order refactor: wallet removal, stock removal, weekly ordering, surplus flow |
| `docs/PWA_GUIDE.md` | 334 | Remove "low balance alerts" mention. Update push notification examples for weekly ordering |

### 13.3 Docs Needing MINOR Updates

| File | Lines | Changes |

|------|-------|---------|
| `docs/BUG_ANALYSIS_CART_MENU.md` | 1961 | Add banner: findings may be partially obsolete after refactor |
| `docs/BUG_REPORT.md` | 531 | Add banner: balance/stock bugs resolved by removal |
| `docs/COMPREHENSIVE_CODE_REVIEW.md` | 640 | Add banner: wallet/stock findings resolved by removal |
| `docs/IMPLEMENTATION_QUALITY.md` | 142 | Update service worker caching context |
| `docs/CI_CD.md` | 403 | Minor — verify test job references deleted files |
| `docs/SECURITY.md` | 402 | Remove balance from Zod schema examples |
| `docs/DEPENDENCIES.md` | 213 | Verify current dependency versions |

### 13.4 Docs OK As-Is

| File | Reason |

|------|--------|
| `docs/CONTRIBUTING.md` | Generic workflow guide |
| `docs/DEPLOYMENT.md` | Vercel/Supabase deploy — no domain-specific content |
| `docs/ISSUE_TEMPLATE.md` | Generic template |
| `docs/PR_TEMPLATE.md` | Generic template |
| `docs/PRIVACY.md` | Generic privacy policy |
| `docs/SETUP.md` | Dev setup instructions |
| `docs/UI_GUIDELINES.md` | Visual design standards |

### 13.5 CI/CD — `.github/workflows/deploy.yml`

- Minor: verify `test-e2e` job handles deleted `concurrency.spec.ts` gracefully
- No structural changes needed — pipeline runs all test files dynamically

---

## Verification Checklist

After completing all phases, verify:

### Wallet Removal

- [ ] Search entire codebase for "wallet", "balance" (as payment), "topup", "top.up", "top_up" → zero relevant hits
- [ ] No `wallets` or `topup_sessions` table in DB
- [ ] No `deduct_balance_with_payment` or `credit_balance_with_payment` functions
- [ ] PaymentMethod type = `'cash' | 'gcash' | 'paymaya' | 'card'` only
- [ ] `/balance` route removed, no navigation links to it
- [ ] Admin Users page has no top-up UI

### Stock Removal

- [ ] Search for "stock_quantity", "decrement_stock", "increment_stock", "low_stock" → zero hits
- [ ] No stock column on `products` table
- [ ] No stock validation in edge functions
- [ ] No "out of stock" or stock badge in UI

### Weekly Ordering

- [ ] `weekly_orders` table created with constraints
- [ ] Order after Friday 5 PM → rejected by edge function AND frontend guard
- [ ] Surplus order after 8 AM → rejected
- [ ] Day cancel after 8 AM → rejected
- [ ] Weekly payment → PayMongo session total = sum of all 5 days
- [ ] Menu shows NEXT week's items (not current week)
- [ ] Cart groups items by day within week
- [ ] Staff sees today's pre-orders as kitchen prep list
- [ ] Weekly reports work correctly

### Code Quality

- [ ] TypeScript build succeeds with zero errors (`pnpm build`)
- [ ] No unused imports
- [ ] All tests pass (`pnpm test`)
- [ ] E2E tests pass (`pnpm test:e2e`)
- [ ] No deprecated code markers remain
- [ ] All docs updated and accurate

---

## Key Decisions

| Decision | Rationale |

|----------|-----------|
| **Weekly order entity** (`weekly_orders` table) | Parent table with child `orders` per day. Preserves daily fulfillment workflow for staff while adding weekly grouping for parents |
| **Wallet removed entirely** | Loheca doesn't use wallet/balance. Simplifies payment to cash + online (gcash/paymaya/card) |
| **`process-order` removed** | All parent orders go through weekly batch flow. No need for single-order edge function |
| **Stock tracking removed entirely** | Canteen prepares based on order count. No inventory limits. |
| **Surplus as separate order type** | Distinct `order_type = 'surplus'` with its own edge function, not a cutoff relaxation. Clean separation of concerns |
| **Per-day cancellation (not per-item)** | Matches business rule: student absent for a day → cancel that day's order until 8 AM |
| **Cart targets next week automatically** | Cart auto-determines target week from cutoff. Parents never accidentally order for the wrong week |
| **Menu publish workflow** | Admin must publish menu before parents can order. Prevents ordering from an incomplete/draft menu |
| **`staff-product` kept** | Different permission level than `manage-product`. Staff can mark surplus; admin does full CRUD |
| **`retry-checkout` kept** | Needed for online payment retry flow |
| **`localQueue` kept** | Needed for offline cash order queuing |

---

## File Impact Summary

| Category | Delete | Create | Modify |

|----------|--------|--------|--------|
| **Edge Functions** | 3 | 4 | 13 |
| **Frontend Pages** | 1 | 0 | 12 |
| **Frontend Components** | 1 | 3 | 6 |
| **Frontend Hooks** | 0 | 0 | 5 |
| **Services** | 0 | 0 | 5 |
| **Types/Utils** | 0 | 0 | 2 |
| **DB Migrations** | 0 | 2 | 0 |
| **Tests** | 3 | 12 | 18 |
| **Documentation** | 0 | 0 | 19 |
| **Other** | 0 | 0 | 2 |
| **TOTAL** | **8** | **21** | **82** |
