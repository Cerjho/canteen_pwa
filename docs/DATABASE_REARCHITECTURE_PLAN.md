# Loheca Canteen — Database Rearchitecture & Redesign Plan

> **Date**: March 5, 2026
> **Status**: Completed
> **Current Schema**: `consolidated_schema.sql` (post-WPA refactor) + 51 migrations
> **Target**: Weekly pre-ordering model, wallet removed, stock removed, deprecated code purged

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Target Entity Relationship Diagram](#3-target-entity-relationship-diagram)
4. [Objects to DROP](#4-objects-to-drop)
5. [New Tables](#5-new-tables)
6. [Modified Tables](#6-modified-tables)
7. [Tables Unchanged](#7-tables-unchanged)
8. [New Functions & Triggers](#8-new-functions--triggers)
9. [Functions & Triggers to DROP](#9-functions--triggers-to-drop)
10. [Functions & Triggers to MODIFY](#10-functions--triggers-to-modify)
11. [Index Changes](#11-index-changes)
12. [RLS Policy Changes](#12-rls-policy-changes)
13. [System Settings Redesign](#13-system-settings-redesign)
14. [Seed Data Updates](#14-seed-data-updates)
15. [Migration Strategy](#15-migration-strategy)
16. [Complete New Schema Reference](#16-complete-new-schema-reference)
17. [Verification Checklist](#17-verification-checklist)

---

## 1. Executive Summary

This is a **major** database rearchitecture that changes the fundamental ordering model from
daily/anytime to weekly pre-ordering. The current schema has **22 tables, 32 functions, 20
triggers, 70+ indexes, and 60+ RLS policies**.

### Changes at a Glance

| Category      | DROP | CREATE | MODIFY | KEEP |
|---------------|------|--------|--------|------|
| Tables        | 3    | 2      | 6      | 12   |
| Functions     | 11   | 8      | 7      | 15   |
| Triggers      | 4    | 5      | 2      | 13   |
| Indexes       | 6    | 14     | 0      | 60+  |
| RLS Policies  | 6    | 9      | 2      | 50+  |
| Settings      | 3    | 4      | 0      | 6    |

### Key Architectural Changes

1. **New `weekly_orders` table** — parent entity grouping a full week (Mon–Fri) of orders per student
2. **New `surplus_items` table** — staff-marked items available for same-day late ordering (until 8 AM)
3. **DROP `wallets` table** — no prepaid wallet system; Loheca doesn't use it
4. **DROP `topup_sessions` table** — no top-up flow
5. **DROP `transactions_legacy` table** — already read-only, table is dead
6. **Remove `stock_quantity`** from products — canteen prepares based on order count, not inventory
7. **Remove `balance`** from all payment method constraints
8. **Remove `meal_period`** from orders (already deprecated — lives on `order_items`)
9. **Add `order_type`** to orders — distinguish `pre_order`, `surplus`, `walk_in`
10. **Rewrite cart validation** — target next week's dates only, enforce weekly cutoff

---

## 2. Current State Analysis

### 2.1 Current Tables (21)

| # | Table                  | Seed Rows | Status                                                     |

|---|------------------------|-----------|------------------------------------------------------------|
| 1 | `user_profiles`        | 3         | **KEEP** — core user table                                 |
| 2 | `wallets`              | 1         | **DROP** — wallet removed                                  |
| 3 | `students`             | 6         | **KEEP** — no changes needed                               |
| 4 | `parent_students`      | 2         | **KEEP** — no changes needed                               |
| 5 | `products`             | 15        | **MODIFY** — remove `stock_quantity`                       |
| 6 | `orders`               | 12        | **MODIFY** — add `weekly_order_id`, `order_type`; drop `meal_period` |
| 7 | `order_items`          | ~24       | **KEEP** — already has `meal_period`, `status`             |
| 8 | `payments`             | ~14       | **MODIFY** — remove `balance`/`topup` from constraints     |
| 9 | `payment_allocations`  | ~14       | **KEEP** — no changes                                      |
| 10 | `topup_sessions`      | 0         | **DROP** — top-up removed                                  |
| 11 | `invitations`         | 0         | **KEEP** — no changes                                      |
| 12 | `menu_schedules`      | 44        | **MODIFY** — add `menu_status` for publish workflow        |
| 13 | `holidays`            | 12        | **KEEP** — no changes                                      |
| 14 | `makeup_days`         | 0         | **KEEP** — no changes                                      |
| 15 | `menu_date_overrides` | 0         | **KEEP** — no changes                                      |
| 16 | `date_closures`       | 0         | **KEEP** — no changes                                      |
| 17 | `system_settings`     | 9         | **MODIFY** — new settings, remove deprecated               |
| 18 | `audit_logs`          | 9         | **KEEP** — no changes                                      |
| 19 | `cart_items`          | 0         | **MODIFY** — validation triggers rewritten                 |
| 20 | `cart_state`          | 0         | **MODIFY** — remove `balance` from constraint              |
| 21 | `favorites`           | 4         | **KEEP** — no changes                                      |
| 22 | `transactions_legacy` | ~14       | **DROP** — dead read-only table                            |

### 2.2 Problems with Current Schema

| Problem | Detail |

|---------|--------|
| **No weekly order concept** | Orders are individual per student×date. No grouping entity for "a week's worth of meals" |
| **No cutoff enforcement at DB level** | `order_cutoff_time` setting exists but is never enforced by a trigger — only soft-checked in frontend |
| **Wallet tables with no business use** | `wallets` and `topup_sessions` exist but Loheca does not use prepaid wallets |
| **Stock tracking with no business use** | `stock_quantity`, `increment_stock`, `decrement_stock` exist but canteen prepares based on order count |
| **Deprecated column still present** | `orders.meal_period` is deprecated (lives on `order_items`) but the column remains with NOT NULL constraint |
| **Dead legacy table** | `transactions_legacy` locked via trigger but still takes up space and creates conceptual confusion |
| **`balance` in constraints everywhere** | Payment method CHECK constraints on `orders`, `payments`, `cart_state` all include `'balance'` |
| **`paymongo` as separate method** | `orders.payment_method` includes both `'paymongo'` and specific methods (gcash/paymaya/card) — redundant |
| **No surplus/late-order concept** | No way to distinguish pre-orders from same-day surplus orders |
| **Cart validates wrong week** | Cart allows ordering 14 days ahead for any date. Should enforce next-week-only targeting |
| **Redundant triggers** | `orders` has TWO `updated_at` triggers (#5 and #19) doing the same thing |
| **`merge_order_items()` no longer needed** | Auto-merge was for daily ordering; weekly orders are submitted as a complete unit |

---

## 3. Target Entity Relationship Diagram

```diagram
┌─────────────────┐
│   auth.users    │
└────────┬────────┘
         │ 1:1
         ▼
┌─────────────────┐
│  user_profiles  │
└────────┬────────┘
         │
    ┌────┴───────────┐
    │                │
    │ 1:N            │ via parent_students
    ▼                ▼
┌──────────┐    ┌─────────────────┐
│ payments │    │ parent_students │ ◄──N:1──┐
└────┬─────┘    └─────────────────┘         │
     │ 1:N                            ┌─────┴─────┐
     ▼                                │  students  │
┌──────────────────────┐              └─────┬──────┘
│ payment_allocations  │                    │
└──────────┬───────────┘                    │ (student_id)
           │ N:1                            │
           ▼                               ▼
      ┌─────────┐  N:1   ┌───────────────────────┐
      │  orders │◄───────┤    weekly_orders (NEW) │
      └────┬────┘        └───────────────────────┘
           │ 1:N
           ▼
   ┌──────────────┐
   │  order_items │
   └──────┬───────┘
          │ N:1
          ▼
   ┌─────────────────┐
   │    products     │
   └────────┬────────┘
            │ 1:N
      ┌─────┴──────┐
      │            │
      ▼            ▼
┌────────────┐  ┌───────────────────┐
│menu_       │  │  surplus_items    │
│schedules   │  │  (NEW)            │
└────────────┘  └───────────────────┘

Standalone (unchanged):
  invitations, holidays, makeup_days, menu_date_overrides,
  date_closures, system_settings, audit_logs,
  cart_items, cart_state, favorites
```

### Simplified Weekly Order Flow

```text
weekly_orders  (1 per student per week — the "weekly pre-order receipt")
  ├── orders → scheduled_for Mon  ──► order_items[]
  ├── orders → scheduled_for Tue  ──► order_items[]
  ├── orders → scheduled_for Wed  ──► order_items[]
  ├── orders → scheduled_for Thu  ──► order_items[]
  └── orders → scheduled_for Fri  ──► order_items[]

payments ──► payment_allocations ──► orders
payments ──► weekly_orders (optional direct link)
```

---

## 4. Objects to DROP

### 4.1 Tables to DROP

| Table | Reason | Dependencies Removed |

|-------|--------|----------------------|
| `wallets` | Wallet system removed | 5 RLS policies, 1 index, 1 trigger, FK |
| `topup_sessions` | Top-up system removed | 1 RLS policy, 3 indexes, FK |
| `transactions_legacy` | Dead locked table | 1 trigger (`block_legacy_writes`) |

### 4.2 Columns to DROP

| Table | Column | Reason |

|-------|--------|--------|
| `products` | `stock_quantity` | Stock tracking removed |
| `orders` | `meal_period` | Deprecated — lives on `order_items.meal_period` |
| `orders` | `paymongo_payment_id` | Redundant — tracked on `payments` table |

### 4.3 Functions to DROP

| # | Function | Reason |

|---|----------|--------|
| 1 | `deduct_balance_with_payment()` | Wallet removed |
| 2 | `credit_balance_with_payment()` | Wallet removed |
| 3 | `increment_stock()` | Stock tracking removed |
| 4 | `decrement_stock()` | Stock tracking removed |
| 5 | `block_legacy_writes()` | `transactions_legacy` table dropped |
| 6 | `validate_cart_item_max_advance()` | Replaced by weekly cutoff validation |
| 7 | `get_todays_menu()` | Redundant with `get_menu_for_date()` |
| 8 | `get_menu_for_day(INT)` | Redundant with `get_menu_for_date()` |
| 9 | `is_menu_available()` | Duplicate of `is_canteen_open()` |
| 10 | `get_dashboard_stats()` | Legacy, replaced by `get_admin_dashboard_stats()` |
| 11 | `merge_order_items()` | Auto-merge not needed — weekly orders submitted as complete unit |

### 4.4 Triggers to DROP

| # | Trigger | Table | Reason |

|---|---------|-------|--------|
| 1 | `update_wallets_updated_at` | `wallets` | Table dropped |
| 2 | `validate_cart_item_max_advance_trigger` | `cart_items` | Function dropped |
| 3 | `trg_block_legacy_writes` | `transactions_legacy` | Table dropped |
| 4 | `trg_orders_updated_at` | `orders` | Redundant duplicate of `update_orders_updated_at` |

### 4.5 Indexes to DROP

| Index | Table | Reason |

|-------|-------|--------|
| `idx_wallets_user_id` | `wallets` | Table dropped |
| `idx_topup_sessions_parent_id` | `topup_sessions` | Table dropped |
| `idx_topup_sessions_checkout_id` | `topup_sessions` | Table dropped |
| `idx_topup_sessions_status` | `topup_sessions` | Table dropped |
| `idx_products_stock_quantity` | `products` | Column dropped |
| `idx_orders_paymongo_payment_id` | `orders` | Column dropped |

### 4.6 RLS Policies to DROP

| Policy | Table | Reason |

|--------|-------|--------|
| Users can view own wallet | `wallets` | Table dropped |
| Users can update own wallet | `wallets` | Table dropped |
| Users can insert own wallet | `wallets` | Table dropped |
| Staff can view all wallets | `wallets` | Table dropped |
| Admin can update any wallet | `wallets` | Table dropped |
| Parents can view own topup sessions | `topup_sessions` | Table dropped |

### 4.7 System Settings to DELETE

| Key | Current Value | Reason |

|-----|---------------|--------|
| `order_cutoff_time` | `"10:00"` | Replaced by `weekly_cutoff_time` |
| `max_future_days` | `5` | Replaced by weekly cutoff logic |
| `low_stock_threshold` | `10` | Stock tracking removed |

---

## 5. New Tables

### 5.1 `weekly_orders`

The central new entity. Groups a parent's order for one student for one full week (Mon–Fri).

```sql
CREATE TABLE weekly_orders (
  id                         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id                  UUID         NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  student_id                 UUID         NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  week_start                 DATE         NOT NULL,
  status                     TEXT         NOT NULL DEFAULT 'submitted'
                               CHECK (status IN ('submitted','active','completed','cancelled')),
  total_amount               NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  payment_method             TEXT         NOT NULL
                               CHECK (payment_method IN ('cash','gcash','paymaya','card')),
  payment_status             payment_status DEFAULT 'awaiting_payment',
  payment_due_at             TIMESTAMPTZ,
  paymongo_checkout_id       TEXT,
  paymongo_checkout_url      TEXT,
  paymongo_payment_intent_id TEXT,
  payment_group_id           UUID,
  notes                      TEXT,
  submitted_at               TIMESTAMPTZ  DEFAULT NOW(),
  created_at                 TIMESTAMPTZ  DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ  DEFAULT NOW(),

  -- One weekly order per student per week
  CONSTRAINT uq_weekly_order_student_week
    UNIQUE (student_id, week_start),

  -- week_start must always be a Monday (ISO day-of-week 1)
  CONSTRAINT chk_week_start_is_monday
    CHECK (EXTRACT(ISODOW FROM week_start) = 1)
);

COMMENT ON TABLE weekly_orders IS
  'Groups a full week (Mon–Fri) of pre-orders for one student. '
  'Created when parent submits their weekly order before the Friday 5 PM cutoff.';
COMMENT ON COLUMN weekly_orders.week_start IS
  'Monday of the target fulfillment week. Always a Monday (ISO day-of-week = 1).';
COMMENT ON COLUMN weekly_orders.status IS
  'submitted  = order placed, week not yet started; '
  'active     = current week, being fulfilled daily; '
  'completed  = all days fulfilled; '
  'cancelled  = entire week cancelled (admin override only).';
```

**Status Transitions:**

```text
submitted  →  active      (automated when target week begins)
submitted  →  cancelled   (admin override only)
active     →  completed   (when all daily orders are fulfilled or cancelled)
active     →  cancelled   (admin force-cancel)
```

**Indexes:**

```sql
CREATE INDEX idx_weekly_orders_parent_id
  ON weekly_orders(parent_id);
CREATE INDEX idx_weekly_orders_student_id
  ON weekly_orders(student_id);
CREATE INDEX idx_weekly_orders_week_start
  ON weekly_orders(week_start);
CREATE INDEX idx_weekly_orders_status
  ON weekly_orders(status);
CREATE INDEX idx_weekly_orders_payment_status
  ON weekly_orders(payment_status) WHERE payment_status = 'awaiting_payment';
CREATE INDEX idx_weekly_orders_payment_due_at
  ON weekly_orders(payment_due_at) WHERE payment_due_at IS NOT NULL;
CREATE INDEX idx_weekly_orders_paymongo_checkout_id
  ON weekly_orders(paymongo_checkout_id) WHERE paymongo_checkout_id IS NOT NULL;
CREATE INDEX idx_weekly_orders_payment_group
  ON weekly_orders(payment_group_id) WHERE payment_group_id IS NOT NULL;
```

---

### 5.2 `surplus_items`

Staff-marked items available for same-day ordering (until 8 AM).

```sql
CREATE TABLE surplus_items (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID    NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  scheduled_date DATE    NOT NULL,
  meal_period    TEXT    CHECK (meal_period IN ('morning_snack','lunch','afternoon_snack')),
  marked_by      UUID    NOT NULL REFERENCES auth.users(id),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_surplus_product_date_meal
    UNIQUE (product_id, scheduled_date, meal_period)
);

COMMENT ON TABLE surplus_items IS
  'Items marked as surplus ("sobra") by staff for today. '
  'Parents can order these via the app or walk in until 8:00 AM. '
  'Staff can also manually place walk-in orders for surplus items.';
COMMENT ON COLUMN surplus_items.scheduled_date IS
  'The date the surplus is available. Must be today (set at time of marking).';
```

**Indexes:**

```sql
CREATE INDEX idx_surplus_items_date
  ON surplus_items(scheduled_date);
CREATE INDEX idx_surplus_items_active
  ON surplus_items(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_surplus_items_product_id
  ON surplus_items(product_id);
```

---

## 6. Modified Tables

### 6.1 `orders` — Add Weekly Link & Order Type, Drop Deprecated Columns

```sql
-- Add new columns
ALTER TABLE orders
  ADD COLUMN weekly_order_id UUID REFERENCES weekly_orders(id) ON DELETE SET NULL,
  ADD COLUMN order_type      TEXT NOT NULL DEFAULT 'pre_order'
    CHECK (order_type IN ('pre_order','surplus','walk_in'));

-- Drop deprecated columns
ALTER TABLE orders
  DROP COLUMN meal_period,
  DROP COLUMN paymongo_payment_id;

-- Update payment_method constraint — remove 'balance' and 'paymongo'
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('cash','gcash','paymaya','card'));
```

**Updated `orders` schema after modification:**

| Column | Type | Constraints | Default | Notes |

|--------|------|-------------|---------|-------|
| `id` | UUID | PK | `gen_random_uuid()` | |
| `parent_id` | UUID | NOT NULL, FK → `user_profiles` | — | |
| `student_id` | UUID | FK → `students` | — | |
| `client_order_id` | UUID | UNIQUE, NOT NULL | — | Idempotency key |
| `weekly_order_id` | UUID | FK → `weekly_orders` | `NULL` | **NEW** — NULL for surplus/walk-in |
| `order_type` | TEXT | NOT NULL, CHECK | `'pre_order'` | **NEW** |
| `status` | TEXT | NOT NULL, CHECK | `'pending'` | State machine |
| `total_amount` | NUMERIC(10,2) | NOT NULL, CHECK ≥ 0 | — | |
| `payment_method` | TEXT | NOT NULL, CHECK | — | cash, gcash, paymaya, card |
| `payment_status` | payment_status | — | `'paid'` | |
| `payment_due_at` | TIMESTAMPTZ | — | — | Cash payment deadline |
| `paymongo_checkout_id` | TEXT | — | — | Initial session only |
| `payment_group_id` | UUID | — | — | Groups multi-order payments |
| `notes` | TEXT | — | — | |
| `scheduled_for` | DATE | — | `CURRENT_DATE` | Specific day (Mon–Fri) |
| `created_at` | TIMESTAMPTZ | — | `NOW()` | |
| `updated_at` | TIMESTAMPTZ | — | `NOW()` | |
| `completed_at` | TIMESTAMPTZ | — | — | |

**New indexes on `orders`:**

```sql
CREATE INDEX idx_orders_weekly_order_id
  ON orders(weekly_order_id) WHERE weekly_order_id IS NOT NULL;
CREATE INDEX idx_orders_order_type
  ON orders(order_type);
```

---

### 6.2 `products` — Remove Stock

```sql
ALTER TABLE products DROP COLUMN stock_quantity;
```

**Updated `products` schema:**

| Column | Type | Constraints | Default |

|--------|------|-------------|---------|
| `id` | UUID | PK | `gen_random_uuid()` |
| `name` | TEXT | NOT NULL | — |
| `description` | TEXT | — | — |
| `price` | NUMERIC(10,2) | NOT NULL, CHECK ≥ 0 | — |
| `category` | TEXT | NOT NULL | — |
| `image_url` | TEXT | — | — |
| `available` | BOOLEAN | — | `TRUE` |
| `created_at` | TIMESTAMPTZ | — | `NOW()` |
| `updated_at` | TIMESTAMPTZ | — | `NOW()` |

---

### 6.3 `payments` — Remove Balance/Topup, Add Weekly Link

```sql
-- Remove 'balance' from method
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('cash','gcash','paymaya','card'));

-- Remove 'topup' from type
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_type_check;
ALTER TABLE payments ADD CONSTRAINT payments_type_check
  CHECK (type IN ('payment','refund'));

-- Optional direct link to weekly order
ALTER TABLE payments ADD COLUMN weekly_order_id UUID REFERENCES weekly_orders(id);
```

**New index:**

```sql
CREATE INDEX idx_payments_weekly_order_id
  ON payments(weekly_order_id) WHERE weekly_order_id IS NOT NULL;
```

---

### 6.4 `cart_state` — Remove Balance

```sql
ALTER TABLE cart_state DROP CONSTRAINT IF EXISTS cart_state_payment_method_check;
ALTER TABLE cart_state ADD CONSTRAINT cart_state_payment_method_check
  CHECK (payment_method IN ('cash','gcash','paymaya','card'));
```

---

### 6.5 `cart_items` — No Schema Change

No column changes. The validation trigger is rewritten (see section 10.1).

---

### 6.6 `menu_schedules` — Add Publish Status

```sql
ALTER TABLE menu_schedules
  ADD COLUMN menu_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (menu_status IN ('draft','published','locked'));

COMMENT ON COLUMN menu_schedules.menu_status IS
  'draft     = admin still editing the week''s menu; '
  'published = visible to parents for ordering; '
  'locked    = past cutoff, no further edits allowed.';
```

---

## 7. Tables Unchanged

These tables require no schema changes (some get new RLS policies for new tables, but the tables themselves stay the same):

| Table | Reason |

|-------|--------|
| `user_profiles` | Core user table — stable |
| `students` | Student data — stable |
| `parent_students` | M:N link — stable |
| `order_items` | Already has `meal_period`, `status` at item level |
| `payment_allocations` | Payment linking — stable |
| `invitations` | Registration flow — stable |
| `holidays` | Calendar data — stable |
| `makeup_days` | Saturday makeup classes — stable |
| `menu_date_overrides` | Per-date menu tweaks — stable |
| `date_closures` | Ad-hoc closures — stable |
| `audit_logs` | Audit trail — stable |
| `favorites` | User preferences — stable |

---

## 8. New Functions & Triggers

### 8.1 `validate_weekly_order_cutoff()` — Trigger Function

Prevents weekly order creation after Friday 5 PM (Manila TZ) for the target week.

```sql
CREATE OR REPLACE FUNCTION validate_weekly_order_cutoff()
RETURNS TRIGGER AS $$
DECLARE
  v_cutoff_time TEXT;
  v_cutoff_ts   TIMESTAMPTZ;
  v_now_manila  TIMESTAMPTZ;
BEGIN
  SELECT COALESCE(
    (SELECT value #>> '{}' FROM system_settings WHERE key = 'weekly_cutoff_time'),
    '17:00'
  ) INTO v_cutoff_time;

  -- The cutoff is the Friday BEFORE week_start (week_start - 3 days) at cutoff_time Manila
  v_cutoff_ts := ((NEW.week_start - INTERVAL '3 days')::TEXT
                  || ' ' || v_cutoff_time)::TIMESTAMPTZ AT TIME ZONE 'Asia/Manila';
  v_now_manila := NOW() AT TIME ZONE 'Asia/Manila';

  IF v_now_manila > v_cutoff_ts THEN
    RAISE EXCEPTION
      'Weekly order cutoff has passed. Orders for the week of % closed on Friday at %.',
      NEW.week_start, v_cutoff_time
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_validate_weekly_order_cutoff
  BEFORE INSERT ON weekly_orders
  FOR EACH ROW
  EXECUTE FUNCTION validate_weekly_order_cutoff();
```

---

### 8.2 `validate_surplus_order_cutoff()` — Trigger Function

Prevents surplus/walk-in orders after 8 AM same day.

```sql
CREATE OR REPLACE FUNCTION validate_surplus_order_cutoff()
RETURNS TRIGGER AS $$
DECLARE
  v_cutoff    TEXT;
  v_now_ph    TIMESTAMPTZ;
  v_cutoff_ts TIMESTAMPTZ;
  v_today_ph  DATE;
BEGIN
  IF NEW.order_type NOT IN ('surplus', 'walk_in') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(
    (SELECT value #>> '{}' FROM system_settings WHERE key = 'surplus_cutoff_time'),
    '08:00'
  ) INTO v_cutoff;

  v_now_ph    := NOW() AT TIME ZONE 'Asia/Manila';
  v_today_ph  := v_now_ph::DATE;
  v_cutoff_ts := (v_today_ph::TEXT || ' ' || v_cutoff)::TIMESTAMPTZ
                 AT TIME ZONE 'Asia/Manila';

  IF v_now_ph > v_cutoff_ts THEN
    RAISE EXCEPTION 'Surplus ordering is closed. Deadline was % today.',
      v_cutoff USING ERRCODE = 'P0002';
  END IF;

  IF NEW.scheduled_for != v_today_ph THEN
    RAISE EXCEPTION 'Surplus orders can only be placed for today.'
      USING ERRCODE = 'P0003';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_validate_surplus_order_cutoff
  BEFORE INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION validate_surplus_order_cutoff();
```

---

### 8.3 `validate_daily_cancellation()` — RPC

Called by edge function before cancelling a day. Returns confirmation or raises an exception.

```sql
CREATE OR REPLACE FUNCTION validate_daily_cancellation(
  p_order_id  UUID,
  p_parent_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_order      RECORD;
  v_cutoff     TEXT;
  v_cutoff_ts  TIMESTAMPTZ;
  v_now_ph     TIMESTAMPTZ;
BEGIN
  SELECT o.id, o.status, o.scheduled_for, o.total_amount, o.weekly_order_id
  INTO v_order
  FROM orders o
  WHERE o.id = p_order_id
    AND o.parent_id = p_parent_id
    AND o.status NOT IN ('cancelled', 'completed');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or already cancelled/completed.'
      USING ERRCODE = 'P0004';
  END IF;

  SELECT COALESCE(
    (SELECT value #>> '{}' FROM system_settings WHERE key = 'daily_cancel_cutoff_time'),
    '08:00'
  ) INTO v_cutoff;

  v_now_ph    := NOW() AT TIME ZONE 'Asia/Manila';
  v_cutoff_ts := (v_order.scheduled_for::TEXT || ' ' || v_cutoff)::TIMESTAMPTZ
                 AT TIME ZONE 'Asia/Manila';

  IF v_now_ph > v_cutoff_ts THEN
    RAISE EXCEPTION 'Cannot cancel — past the % cancellation deadline for %.',
      v_cutoff, v_order.scheduled_for USING ERRCODE = 'P0005';
  END IF;

  RETURN jsonb_build_object(
    'order_id',       v_order.id,
    'scheduled_for',  v_order.scheduled_for,
    'total_amount',   v_order.total_amount,
    'can_cancel',     TRUE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

### 8.4 `transition_weekly_order_status()` — Trigger Function

Auto-transitions weekly order status based on child order completion.

```sql
CREATE OR REPLACE FUNCTION transition_weekly_order_status()
RETURNS TRIGGER AS $$
DECLARE
  v_wid        UUID;
  v_total      INT;
  v_completed  INT;
  v_cancelled  INT;
BEGIN
  v_wid := COALESCE(NEW.weekly_order_id, OLD.weekly_order_id);
  IF v_wid IS NULL THEN RETURN NEW; END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'cancelled')
  INTO v_total, v_completed, v_cancelled
  FROM orders
  WHERE weekly_order_id = v_wid;

  -- All days are terminal (completed or cancelled) → close the weekly order
  IF (v_completed + v_cancelled) = v_total AND v_total > 0 THEN
    UPDATE weekly_orders
    SET
      status     = CASE WHEN v_cancelled = v_total THEN 'cancelled' ELSE 'completed' END,
      updated_at = NOW()
    WHERE id = v_wid
      AND status NOT IN ('completed', 'cancelled');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_transition_weekly_order_status
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  WHEN (NEW.weekly_order_id IS NOT NULL)
  EXECUTE FUNCTION transition_weekly_order_status();
```

---

### 8.5 `recalculate_weekly_order_total()` — Trigger Function

Recalculates weekly order `total_amount` when a daily order is cancelled (e.g., student absent).

```sql
CREATE OR REPLACE FUNCTION recalculate_weekly_order_total()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'cancelled'
     AND OLD.status != 'cancelled'
     AND NEW.weekly_order_id IS NOT NULL
  THEN
    UPDATE weekly_orders
    SET
      total_amount = (
        SELECT COALESCE(SUM(total_amount), 0)
        FROM orders
        WHERE weekly_order_id = NEW.weekly_order_id
          AND status != 'cancelled'
      ),
      updated_at = NOW()
    WHERE id = NEW.weekly_order_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_recalculate_weekly_order_total
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status != 'cancelled')
  EXECUTE FUNCTION recalculate_weekly_order_total();
```

---

### 8.6 `get_weekly_order_summary()` — RPC

Kitchen prep aggregation — used by staff to see exactly what to prepare per day.

```sql
CREATE OR REPLACE FUNCTION get_weekly_order_summary(p_week_start DATE)
RETURNS TABLE (
  scheduled_for   DATE,
  meal_period     TEXT,
  product_id      UUID,
  product_name    TEXT,
  total_quantity  BIGINT,
  order_count     BIGINT,
  grade_breakdown JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.scheduled_for,
    oi.meal_period,
    oi.product_id,
    p.name                      AS product_name,
    SUM(oi.quantity)::BIGINT    AS total_quantity,
    COUNT(DISTINCT o.id)::BIGINT AS order_count,
    jsonb_object_agg(
      COALESCE(s.grade_level, 'unknown'),
      grade_counts.qty
    )                           AS grade_breakdown
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  JOIN products p    ON p.id = oi.product_id
  LEFT JOIN students s ON s.id = o.student_id
  LEFT JOIN LATERAL (
    SELECT SUM(oi2.quantity)::BIGINT AS qty
    FROM orders o2
    JOIN order_items oi2 ON oi2.order_id = o2.id
    JOIN students s2     ON s2.id = o2.student_id
    WHERE o2.scheduled_for  = o.scheduled_for
      AND oi2.product_id    = oi.product_id
      AND oi2.meal_period   = oi.meal_period
      AND s2.grade_level    = s.grade_level
      AND o2.status        != 'cancelled'
      AND oi2.status        = 'confirmed'
  ) grade_counts ON TRUE
  WHERE o.scheduled_for >= p_week_start
    AND o.scheduled_for <  p_week_start + INTERVAL '5 days'
    AND o.status        != 'cancelled'
    AND oi.status        = 'confirmed'
  GROUP BY o.scheduled_for, oi.meal_period, oi.product_id, p.name
  ORDER BY o.scheduled_for, oi.meal_period, p.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

### 8.7 `get_weekly_report()` — RPC

Weekly reporting aggregation for admin.

```sql
CREATE OR REPLACE FUNCTION get_weekly_report(p_week_start DATE)
RETURNS TABLE (
  total_weekly_orders    BIGINT,
  total_students         BIGINT,
  total_revenue          NUMERIC,
  total_cancelled_days   BIGINT,
  cancelled_revenue      NUMERIC,
  surplus_orders         BIGINT,
  surplus_revenue        NUMERIC,
  daily_breakdown        JSONB,
  payment_method_breakdown JSONB,
  top_products           JSONB
) AS $$
DECLARE
  v_end DATE := p_week_start + INTERVAL '5 days';
BEGIN
  RETURN QUERY SELECT
    (SELECT COUNT(*) FROM weekly_orders
     WHERE week_start = p_week_start AND status != 'cancelled')::BIGINT,

    (SELECT COUNT(DISTINCT student_id) FROM weekly_orders
     WHERE week_start = p_week_start AND status != 'cancelled')::BIGINT,

    (SELECT COALESCE(SUM(total_amount), 0) FROM orders
     WHERE scheduled_for >= p_week_start AND scheduled_for < v_end
       AND status != 'cancelled' AND order_type = 'pre_order')::NUMERIC,

    (SELECT COUNT(*) FROM orders
     WHERE scheduled_for >= p_week_start AND scheduled_for < v_end
       AND status = 'cancelled' AND order_type = 'pre_order')::BIGINT,

    (SELECT COALESCE(SUM(total_amount), 0) FROM orders
     WHERE scheduled_for >= p_week_start AND scheduled_for < v_end
       AND status = 'cancelled' AND order_type = 'pre_order')::NUMERIC,

    (SELECT COUNT(*) FROM orders
     WHERE scheduled_for >= p_week_start AND scheduled_for < v_end
       AND order_type IN ('surplus','walk_in') AND status != 'cancelled')::BIGINT,

    (SELECT COALESCE(SUM(total_amount), 0) FROM orders
     WHERE scheduled_for >= p_week_start AND scheduled_for < v_end
       AND order_type IN ('surplus','walk_in') AND status != 'cancelled')::NUMERIC,

    -- Daily breakdown
    (SELECT jsonb_agg(jsonb_build_object(
        'date', d.day, 'orders', d.cnt, 'revenue', d.rev
     ) ORDER BY d.day)
     FROM (
       SELECT scheduled_for AS day, COUNT(*) AS cnt, SUM(total_amount) AS rev
       FROM orders
       WHERE scheduled_for >= p_week_start AND scheduled_for < v_end
         AND status != 'cancelled'
       GROUP BY scheduled_for
     ) d),

    -- Payment method breakdown
    (SELECT jsonb_agg(jsonb_build_object(
        'method', pm.payment_method, 'count', pm.cnt, 'amount', pm.total
     ))
     FROM (
       SELECT payment_method, COUNT(*) AS cnt, SUM(total_amount) AS total
       FROM orders
       WHERE scheduled_for >= p_week_start AND scheduled_for < v_end
         AND status != 'cancelled'
       GROUP BY payment_method
     ) pm),

    -- Top 10 products
    (SELECT jsonb_agg(jsonb_build_object(
        'product_name', tp.name, 'total_quantity', tp.qty, 'revenue', tp.rev
     ))
     FROM (
       SELECT p.name, SUM(oi.quantity) AS qty,
              SUM(oi.quantity * oi.price_at_order) AS rev
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       WHERE o.scheduled_for >= p_week_start AND o.scheduled_for < v_end
         AND o.status != 'cancelled' AND oi.status = 'confirmed'
       GROUP BY p.name ORDER BY qty DESC LIMIT 10
     ) tp);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

### 8.8 `update_weekly_orders_updated_at` — Trigger

```sql
CREATE TRIGGER update_weekly_orders_updated_at
  BEFORE UPDATE ON weekly_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

---

## 9. Functions & Triggers to DROP

| # | Object | Type | Reason |

|---|--------|------|--------|
| 1 | `deduct_balance_with_payment()` | FUNCTION | Wallet removed |
| 2 | `credit_balance_with_payment()` | FUNCTION | Wallet removed |
| 3 | `increment_stock()` | FUNCTION | Stock removed |
| 4 | `decrement_stock()` | FUNCTION | Stock removed |
| 5 | `block_legacy_writes()` | FUNCTION | Legacy table dropped |
| 6 | `validate_cart_item_max_advance()` | FUNCTION | Replaced by weekly cutoff trigger |
| 7 | `get_todays_menu()` | FUNCTION | Redundant — use `get_menu_for_date()` |
| 8 | `get_menu_for_day(INT)` | FUNCTION | Redundant — use `get_menu_for_date()` |
| 9 | `is_menu_available()` | FUNCTION | Duplicate of `is_canteen_open()` |
| 10 | `get_dashboard_stats()` | FUNCTION | Legacy, replaced by `get_admin_dashboard_stats()` |
| 11 | `merge_order_items()` | FUNCTION | Auto-merge not needed for weekly orders |
| 12 | `update_wallets_updated_at` | TRIGGER | Table dropped |
| 13 | `validate_cart_item_max_advance_trigger` | TRIGGER | Function dropped |
| 14 | `trg_block_legacy_writes` | TRIGGER | Table dropped |
| 15 | `trg_orders_updated_at` | TRIGGER | Redundant duplicate |

---

## 10. Functions & Triggers to MODIFY

### 10.1 `validate_cart_item_date()` — Rewrite

**Current**: No past dates, no Sundays, Saturdays only if makeup, no holidays, max 14 days ahead.

**New**: Same base validations **plus** enforce `scheduled_for` must be within the **next orderable week** (Mon–Fri determined by the current cutoff state).

```sql
CREATE OR REPLACE FUNCTION validate_cart_item_date()
RETURNS TRIGGER AS $$
DECLARE
  v_now_ph       TIMESTAMPTZ;
  v_today        DATE;
  v_dow          INT;
  v_cutoff_time  TEXT;
  v_cutoff_ts    TIMESTAMPTZ;
  v_this_friday  DATE;
  v_next_monday  DATE;
  v_next_friday  DATE;
BEGIN
  v_now_ph := NOW() AT TIME ZONE 'Asia/Manila';
  v_today  := v_now_ph::DATE;
  v_dow    := EXTRACT(ISODOW FROM NEW.scheduled_for);

  -- No past dates
  IF NEW.scheduled_for < v_today THEN
    RAISE EXCEPTION 'Cannot add items for past dates.' USING ERRCODE = 'P0010';
  END IF;

  -- No Sundays (ISO 7)
  IF v_dow = 7 THEN
    RAISE EXCEPTION 'Canteen is closed on Sundays.' USING ERRCODE = 'P0011';
  END IF;

  -- Saturdays only if makeup day
  IF v_dow = 6 THEN
    IF NOT EXISTS (SELECT 1 FROM makeup_days WHERE date = NEW.scheduled_for) THEN
      RAISE EXCEPTION 'Canteen is closed on Saturdays unless it is a makeup day.'
        USING ERRCODE = 'P0012';
    END IF;
  END IF;

  -- No holidays
  IF EXISTS (
    SELECT 1 FROM holidays
    WHERE date = NEW.scheduled_for
       OR (is_recurring
           AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM NEW.scheduled_for)
           AND EXTRACT(DAY   FROM date) = EXTRACT(DAY   FROM NEW.scheduled_for))
  ) THEN
    RAISE EXCEPTION 'Canteen is closed on this holiday.' USING ERRCODE = 'P0013';
  END IF;

  -- Determine the next orderable week
  -- Monday following today
  v_next_monday := v_today + ((8 - EXTRACT(ISODOW FROM v_today)::INT) % 7 + 1);
  -- If today is already Monday, that IS next Monday (already past)

  SELECT COALESCE(
    (SELECT value #>> '{}' FROM system_settings WHERE key = 'weekly_cutoff_time'),
    '17:00'
  ) INTO v_cutoff_time;

  -- Friday of the current week
  v_this_friday := v_today + (5 - EXTRACT(ISODOW FROM v_today)::INT);

  -- If today is Mon–Fri, check whether we are still before cutoff
  IF EXTRACT(ISODOW FROM v_today) BETWEEN 1 AND 5 THEN
    v_cutoff_ts := (v_this_friday::TEXT || ' ' || v_cutoff_time)::TIMESTAMPTZ
                   AT TIME ZONE 'Asia/Manila';
    IF v_now_ph > v_cutoff_ts THEN
      -- Past cutoff → shift target to the week after next
      v_next_monday := v_next_monday + INTERVAL '7 days';
    END IF;
  END IF;
  -- Weekend: v_next_monday is already the correct coming Monday

  v_next_friday := v_next_monday + INTERVAL '4 days';

  IF NEW.scheduled_for < v_next_monday OR NEW.scheduled_for > v_next_friday THEN
    RAISE EXCEPTION 'Items can only be added for next week (% to %).', v_next_monday, v_next_friday
      USING ERRCODE = 'P0014';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

### 10.2 `validate_order_status_transition()` — Minor Documentation Update

No logic change. Documented state machine:

```text
awaiting_payment → pending, cancelled
pending          → preparing, cancelled
preparing        → ready, cancelled
ready            → completed, cancelled
completed        → (terminal)
cancelled        → (terminal)
```

---

### 10.3 `get_admin_dashboard_stats()` — Add Weekly Metrics

Extend the return with:

- `weekly_orders_this_week` — count of `weekly_orders` for current week
- `weekly_orders_next_week` — count for next week (pre-orders already submitted)
- `surplus_orders_today` — count of surplus/walk-in orders today
- Update `revenue_this_week` aggregation to use `weekly_orders` as the base

---

### 10.4 `get_daily_sales_summary()` — Add Order Type Breakdown

Add `order_type` grouping to daily summary so reports show pre-order vs surplus revenue separately.

---

### 10.5 `cleanup_past_cart_items()` — Keep As-Is

Already deletes `cart_items WHERE scheduled_for < NOW() AT TIME ZONE 'Asia/Manila'`. No change needed.

---

## 11. Index Changes

### 11.1 Indexes to DROP

| Index | Table | Reason |

|-------|-------|--------|
| `idx_wallets_user_id` | `wallets` | Table dropped |
| `idx_topup_sessions_parent_id` | `topup_sessions` | Table dropped |
| `idx_topup_sessions_checkout_id` | `topup_sessions` | Table dropped |
| `idx_topup_sessions_status` | `topup_sessions` | Table dropped |
| `idx_products_stock_quantity` | `products` | Column dropped |
| `idx_orders_paymongo_payment_id` | `orders` | Column dropped |

### 11.2 Indexes to CREATE

| Index | Table | Columns | Notes |

|-------|-------|---------|-------|
| `idx_weekly_orders_parent_id` | `weekly_orders` | `(parent_id)` | |
| `idx_weekly_orders_student_id` | `weekly_orders` | `(student_id)` | |
| `idx_weekly_orders_week_start` | `weekly_orders` | `(week_start)` | |
| `idx_weekly_orders_status` | `weekly_orders` | `(status)` | |
| `idx_weekly_orders_payment_status` | `weekly_orders` | `(payment_status)` | Partial: `WHERE = 'awaiting_payment'` |
| `idx_weekly_orders_payment_due_at` | `weekly_orders` | `(payment_due_at)` | Partial: `IS NOT NULL` |
| `idx_weekly_orders_paymongo_checkout_id` | `weekly_orders` | `(paymongo_checkout_id)` | Partial: `IS NOT NULL` |
| `idx_weekly_orders_payment_group` | `weekly_orders` | `(payment_group_id)` | Partial: `IS NOT NULL` |
| `idx_orders_weekly_order_id` | `orders` | `(weekly_order_id)` | Partial: `IS NOT NULL` |
| `idx_orders_order_type` | `orders` | `(order_type)` | |
| `idx_surplus_items_date` | `surplus_items` | `(scheduled_date)` | |
| `idx_surplus_items_active` | `surplus_items` | `(is_active)` | Partial: `WHERE TRUE` |
| `idx_surplus_items_product_id` | `surplus_items` | `(product_id)` | |
| `idx_payments_weekly_order_id` | `payments` | `(weekly_order_id)` | Partial: `IS NOT NULL` |

---

## 12. RLS Policy Changes

### 12.1 Policies to DROP

All 6 policies on `wallets` (5) and `topup_sessions` (1) are automatically dropped with those tables.

### 12.2 New Policies — `weekly_orders`

```sql
ALTER TABLE weekly_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parents can view own weekly orders"
  ON weekly_orders FOR SELECT
  USING (auth.uid() = parent_id);

CREATE POLICY "Parents can create weekly orders"
  ON weekly_orders FOR INSERT
  WITH CHECK (
    auth.uid() = parent_id
    AND EXISTS (
      SELECT 1 FROM parent_students
      WHERE parent_id = auth.uid()
        AND student_id = weekly_orders.student_id
    )
  );

CREATE POLICY "Staff can view all weekly orders"
  ON weekly_orders FOR SELECT
  USING (is_staff_or_admin());

CREATE POLICY "Staff can update weekly orders"
  ON weekly_orders FOR UPDATE
  USING (is_staff_or_admin());

CREATE POLICY "Admin can delete weekly orders"
  ON weekly_orders FOR DELETE
  USING (is_admin());
```

### 12.3 New Policies — `surplus_items`

```sql
ALTER TABLE surplus_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view active surplus items"
  ON surplus_items FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Staff can create surplus items"
  ON surplus_items FOR INSERT
  WITH CHECK (is_staff_or_admin());

CREATE POLICY "Staff can update surplus items"
  ON surplus_items FOR UPDATE
  USING (is_staff_or_admin());

CREATE POLICY "Staff can delete surplus items"
  ON surplus_items FOR DELETE
  USING (is_staff_or_admin());
```

### 12.4 Existing Policies to MODIFY

| Table | Policy | Change |

|-------|--------|--------|
| `orders` | "Parents can create orders" | Add: `order_type = 'pre_order'` requires `weekly_order_id IS NOT NULL` |
| `payments` | (all) | No policy change — constraint update handles `'balance'`/`'topup'` removal |

---

## 13. System Settings Redesign

### 13.1 Settings to REMOVE

| Key | Reason |

|-----|--------|
| `order_cutoff_time` | Replaced by `weekly_cutoff_time` |
| `max_future_days` | Replaced by weekly cutoff logic in cart trigger |
| `low_stock_threshold` | Stock tracking removed |

### 13.2 Settings to ADD

```sql
INSERT INTO system_settings (key, value, description) VALUES
  ('weekly_cutoff_day',
   '"friday"',
   'Day of week when weekly ordering window closes (lowercase)'),
  ('weekly_cutoff_time',
   '"17:00"',
   'Time on cutoff day when ordering closes — 24-hour format, Asia/Manila TZ'),
  ('surplus_cutoff_time',
   '"08:00"',
   'Daily deadline for surplus and walk-in orders — 24-hour format, Asia/Manila TZ'),
  ('daily_cancel_cutoff_time',
   '"08:00"',
   'Daily deadline for parents to cancel individual days — 24-hour format, Asia/Manila TZ');
```

### 13.3 Settings to KEEP

| Key | Value | Description |

|-----|-------|-------------|
| `canteen_name` | `"LOHECA Canteen"` | Canteen display name |
| `operating_hours` | `{"open":"07:00","close":"15:00"}` | Hours of operation (for staff reference) |
| `allow_future_orders` | `true` | Master switch to enable/disable ordering window |
| `auto_complete_orders` | `false` | Auto-complete orders after pickup |
| `notification_email` | `null` | Admin notification email |
| `maintenance_mode` | `false` | App-wide maintenance mode |

---

## 14. Seed Data Updates

Changes to `supabase/migrations/20260220_seed_data.sql`:

### 14.1 Remove from Seed

- All `INSERT INTO wallets` rows (parent wallet with ₱500 balance)
- All `INSERT INTO transactions_legacy` rows (~14 rows)
- `stock_quantity` values from all product INSERTs

### 14.2 Modify in Seed

**Products** — remove `stock_quantity`:

```sql
-- Before:
INSERT INTO products (id, name, price, category, stock_quantity, available)
VALUES (..., 50, TRUE);

-- After:
INSERT INTO products (id, name, price, category, available)
VALUES (..., TRUE);
```

**Orders** — remove `meal_period`, add `order_type` + `weekly_order_id`:

```sql
-- Before:
INSERT INTO orders (id, parent_id, student_id, ..., meal_period, payment_method)
VALUES (..., 'lunch', 'balance');

-- After:
INSERT INTO orders (id, parent_id, student_id, ..., order_type, payment_method, weekly_order_id)
VALUES (..., 'pre_order', 'cash', '<matching weekly_order id>');
```

**Payments** — update `method` (remove `'balance'`), remove `type = 'topup'` entries:

```sql
-- Before:
INSERT INTO payments (type, method, ...) VALUES ('topup', 'gcash', ...);  -- REMOVE

-- Before:
INSERT INTO payments (type, method, ...) VALUES ('payment', 'balance', ...);
-- After:
INSERT INTO payments (type, method, ...) VALUES ('payment', 'cash', ...);
```

### 14.3 Add to Seed

```sql
-- Weekly orders for demo data
INSERT INTO weekly_orders
  (id, parent_id, student_id, week_start, status, total_amount, payment_method, payment_status)
VALUES
  ('wo-demo-001', '<parent-uuid>', '<student1-uuid>',
   '2026-02-23', 'completed', 275.00, 'cash', 'paid'),
  ('wo-demo-002', '<parent-uuid>', '<student2-uuid>',
   '2026-02-23', 'completed', 275.00, 'cash', 'paid');
```

---

## 15. Migration Strategy

### 15.1 Migration Files

Execute in order as a single Supabase migration push:

```text
supabase/migrations/
  20260305000001_wpa_schema.sql       ← New tables, ADD COLUMN, constraint updates
  20260305000002_wpa_functions.sql    ← New functions & triggers; rewrite validate_cart_item_date
  20260305000003_wpa_rls.sql          ← RLS for weekly_orders, surplus_items
  20260305000004_wpa_data.sql         ← Data migration + settings update
  20260305000005_wpa_cleanup.sql      ← DROP tables, columns, functions, old constraints
```

### 15.2 Migration 1 — Schema

```sql
-- 20260305000001_wpa_schema.sql

-- New tables
CREATE TABLE weekly_orders ( ... );   -- full definition from section 5.1
CREATE TABLE surplus_items  ( ... );  -- full definition from section 5.2

-- Modify orders
ALTER TABLE orders
  ADD COLUMN weekly_order_id UUID REFERENCES weekly_orders(id) ON DELETE SET NULL,
  ADD COLUMN order_type TEXT NOT NULL DEFAULT 'pre_order'
    CHECK (order_type IN ('pre_order','surplus','walk_in'));

-- Modify payments
ALTER TABLE payments
  ADD COLUMN weekly_order_id UUID REFERENCES weekly_orders(id);

-- Modify menu_schedules
ALTER TABLE menu_schedules
  ADD COLUMN menu_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (menu_status IN ('draft','published','locked'));

-- New indexes (from sections 5.1, 5.2, 6.1, and payments)
-- ... (all CREATE INDEX statements)
```

### 15.3 Migration 2 — Functions & Triggers

```sql
-- 20260305000002_wpa_functions.sql

-- Rewrite cart validation
CREATE OR REPLACE FUNCTION validate_cart_item_date() ...;

-- New trigger functions
CREATE OR REPLACE FUNCTION validate_weekly_order_cutoff() ...;
CREATE OR REPLACE FUNCTION validate_surplus_order_cutoff() ...;
CREATE OR REPLACE FUNCTION validate_daily_cancellation() ...;
CREATE OR REPLACE FUNCTION transition_weekly_order_status() ...;
CREATE OR REPLACE FUNCTION recalculate_weekly_order_total() ...;

-- New RPCs
CREATE OR REPLACE FUNCTION get_weekly_order_summary() ...;
CREATE OR REPLACE FUNCTION get_weekly_report() ...;

-- Create triggers
CREATE TRIGGER trg_validate_weekly_order_cutoff ...;
CREATE TRIGGER trg_validate_surplus_order_cutoff ...;
CREATE TRIGGER trg_transition_weekly_order_status ...;
CREATE TRIGGER trg_recalculate_weekly_order_total ...;
CREATE TRIGGER update_weekly_orders_updated_at ...;

-- Remove redundant trigger
DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
DROP TRIGGER IF EXISTS validate_cart_item_max_advance_trigger ON cart_items;
```

### 15.4 Migration 3 — RLS

```sql
-- 20260305000003_wpa_rls.sql

ALTER TABLE weekly_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE surplus_items  ENABLE ROW LEVEL SECURITY;

-- 5 policies for weekly_orders
-- 4 policies for surplus_items
-- (full statements from section 12)
```

### 15.5 Migration 4 — Data

```sql
-- 20260305000004_wpa_data.sql

-- Backfill weekly_orders from existing orders
INSERT INTO weekly_orders
  (parent_id, student_id, week_start, status, total_amount, payment_method, payment_status, submitted_at)
SELECT
  parent_id,
  student_id,
  date_trunc('week', scheduled_for)::DATE   AS week_start,
  'completed'                               AS status,
  SUM(total_amount)                         AS total_amount,
  MIN(payment_method)                       AS payment_method,
  'paid'                                    AS payment_status,
  MIN(created_at)                           AS submitted_at
FROM orders
WHERE status NOT IN ('cancelled')
  AND student_id IS NOT NULL
GROUP BY parent_id, student_id, date_trunc('week', scheduled_for)
ON CONFLICT (student_id, week_start) DO NOTHING;

-- Link existing orders to their weekly_order
UPDATE orders o
SET weekly_order_id = wo.id,
    order_type      = 'pre_order'
FROM weekly_orders wo
WHERE o.parent_id   = wo.parent_id
  AND o.student_id  = wo.student_id
  AND date_trunc('week', o.scheduled_for)::DATE = wo.week_start;

-- Update system settings
DELETE FROM system_settings
  WHERE key IN ('order_cutoff_time','max_future_days','low_stock_threshold');

INSERT INTO system_settings (key, value, description) VALUES
  ('weekly_cutoff_day',       '"friday"', 'Cutoff day for weekly orders'),
  ('weekly_cutoff_time',      '"17:00"',  'Cutoff time — 24h, Asia/Manila TZ'),
  ('surplus_cutoff_time',     '"08:00"',  'Surplus order deadline — 24h, Asia/Manila TZ'),
  ('daily_cancel_cutoff_time','"08:00"',  'Day cancellation deadline — 24h, Asia/Manila TZ');
```

### 15.6 Migration 5 — Cleanup (Destructive)

> ⚠️ Run only after verifying the data migration above succeeded.

```sql
-- 20260305000005_wpa_cleanup.sql

-- Drop deprecated columns
ALTER TABLE orders    DROP COLUMN IF EXISTS meal_period;
ALTER TABLE orders    DROP COLUMN IF EXISTS paymongo_payment_id;
ALTER TABLE products  DROP COLUMN IF EXISTS stock_quantity;

-- Update constraints — remove 'balance' / 'paymongo'
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('cash','gcash','paymaya','card'));

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('cash','gcash','paymaya','card'));

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_type_check;
ALTER TABLE payments ADD CONSTRAINT payments_type_check
  CHECK (type IN ('payment','refund'));

ALTER TABLE cart_state DROP CONSTRAINT IF EXISTS cart_state_payment_method_check;
ALTER TABLE cart_state ADD CONSTRAINT cart_state_payment_method_check
  CHECK (payment_method IN ('cash','gcash','paymaya','card'));

-- Drop old functions and their triggers
DROP TRIGGER IF EXISTS validate_cart_item_max_advance_trigger ON cart_items;
DROP TRIGGER IF EXISTS update_wallets_updated_at             ON wallets;
DROP TRIGGER IF EXISTS trg_block_legacy_writes               ON transactions_legacy;

DROP FUNCTION IF EXISTS deduct_balance_with_payment(UUID,NUMERIC,NUMERIC,UUID[],NUMERIC[]);
DROP FUNCTION IF EXISTS credit_balance_with_payment(UUID,NUMERIC,TEXT,TEXT,UUID,TEXT,JSONB);
DROP FUNCTION IF EXISTS increment_stock(UUID,INT);
DROP FUNCTION IF EXISTS decrement_stock(UUID,INT);
DROP FUNCTION IF EXISTS block_legacy_writes();
DROP FUNCTION IF EXISTS validate_cart_item_max_advance();
DROP FUNCTION IF EXISTS get_todays_menu();
DROP FUNCTION IF EXISTS get_menu_for_day(INT);
DROP FUNCTION IF EXISTS is_menu_available(DATE);
DROP FUNCTION IF EXISTS get_dashboard_stats();
DROP FUNCTION IF EXISTS merge_order_items(UUID,JSONB,TEXT,UUID);

-- Drop old indexes (column-based ones already invalid)
DROP INDEX IF EXISTS idx_products_stock_quantity;
DROP INDEX IF EXISTS idx_orders_paymongo_payment_id;

-- Drop tables (FK order matters)
DROP TABLE IF EXISTS topup_sessions;
DROP TABLE IF EXISTS wallets;
DROP TABLE IF EXISTS transactions_legacy;
```

### 15.7 Post-Migration: Regenerate Consolidated Schema

After all migrations succeed, regenerate `supabase/consolidated_schema.sql` by running:

```bash
supabase db dump --local > supabase/consolidated_schema.sql
```

The new consolidated schema should reflect:

| Object Type | Before | After |

|-------------|--------|-------|
| Tables | 22 | **21** (−3 dropped, +2 created) |
| Functions | 32 | **~29** (−11 dropped, +8 added) |
| Triggers | 20 | **~21** (−4 dropped +5 added) |
| Indexes | 70+ | **~78** (−6 dropped, +14 added) |
| RLS Policies | 62 | **~65** (−6 dropped, +9 added) |

---

## 16. Complete New Schema Reference

### 16.1 Table Summary (Post-Refactor)

| # | Table | Purpose | Changed? |

|---|-------|---------|----------|
| 1 | `user_profiles` | Parent/staff/admin accounts | — |
| 2 | `students` | Student records | — |
| 3 | `parent_students` | Parent↔Student M:N links | — |
| 4 | `products` | Menu items (no stock) | Modified |
| 5 | `weekly_orders` | **NEW** — Weekly order per student | New |
| 6 | `orders` | Daily order (child of weekly_orders) | Modified |
| 7 | `order_items` | Line items per daily order | — |
| 8 | `surplus_items` | **NEW** — Staff-marked surplus items | New |
| 9 | `payments` | Payment records | Modified |
| 10 | `payment_allocations` | Payment↔Order links | — |
| 11 | `invitations` | Registration invitations | — |
| 12 | `menu_schedules` | Product↔Date assignments | Modified |
| 13 | `holidays` | Holiday calendar | — |
| 14 | `makeup_days` | Saturday makeup classes | — |
| 15 | `menu_date_overrides` | Per-date menu overrides | — |
| 16 | `date_closures` | Ad-hoc canteen closures | — |
| 17 | `system_settings` | System configuration | Modified |
| 18 | `audit_logs` | Audit trail | — |
| 19 | `cart_items` | Shopping cart (trigger updated) | Modified |
| 20 | `cart_state` | Cart preferences | Modified |
| 21 | `favorites` | User product favorites | — |

### 16.2 Function Summary (Post-Refactor)

| Category | Functions |

|----------|-----------|
| **Auth & Roles** | `is_admin()`, `is_staff_or_admin()`, `sync_user_role()` |
| **Timestamps** | `update_updated_at_column()` |
| **Weekly Ordering** ★ | `validate_weekly_order_cutoff()`, `validate_surplus_order_cutoff()`, `validate_daily_cancellation()`, `transition_weekly_order_status()`, `recalculate_weekly_order_total()` |
| **Cart** | `validate_cart_item_date()` (rewritten), `cleanup_past_cart_items()` |
| **Order Status** | `validate_order_status_transition()` |
| **Calendar** | `is_holiday()`, `is_canteen_open()`, `generate_student_id()` |
| **Menu** | `get_menu_for_date()` |
| **Payments** | `check_allocation_integrity()`, `prevent_amount_mutation()`, `prevent_allocation_amount_mutation()`, `guard_payment_status_transition()` |
| **Reporting** | `get_admin_dashboard_stats()` (modified), `get_daily_sales_summary()` (modified), `get_top_products()`, `get_hourly_distribution()`, `get_weekly_order_summary()` ★, `get_weekly_report()` ★ |
| **Audit** | `log_audit_action()` |

★ = New or rewrote

### 16.3 Final Relationship Summary

```diagram
auth.users  ──1:1──►  user_profiles
                           │
              ┌────────────┼──────────────────────┐
              │            │                      │
              │ 1:N        │ via parent_students  │ 1:N
              ▼            ▼                      ▼
          payments     students              invitations
              │              │
              │ 1:N          │ 1:N (student_id)
              ▼              ▼
   payment_allocations  weekly_orders ──1:N──► orders ──1:N──► order_items
                                                                    │
                                                              N:1 ──┤
                                                                    ▼
                                                               products
                                                                    │
                                                         ┌──────────┤
                                                         │          │
                                                         ▼          ▼
                                                   menu_schedules  surplus_items
```

---

## 17. Verification Checklist

### Schema Integrity

- [ ] `weekly_orders` created — unique `(student_id, week_start)`, Monday CHECK, all indexes
- [ ] `surplus_items` created — unique `(product_id, scheduled_date, meal_period)`, all indexes
- [ ] `wallets` does not exist: `SELECT * FROM pg_tables WHERE tablename = 'wallets'` → 0 rows
- [ ] `topup_sessions` does not exist
- [ ] `transactions_legacy` does not exist
- [ ] `products.stock_quantity` does not exist
- [ ] `orders.meal_period` does not exist
- [ ] `orders.weekly_order_id` FK works and is indexed
- [ ] `orders.order_type` CHECK enforced
- [ ] Payment method constraints exclude `'balance'` on `orders`, `payments`, `cart_state`
- [ ] `payments.type` excludes `'topup'`
- [ ] `menu_schedules.menu_status` column present with correct CHECK

### Trigger Behavior

- [ ] Insert `weekly_orders` before Friday 5 PM → **succeeds**
- [ ] Insert `weekly_orders` after Friday 5 PM → **raises P0001**
- [ ] Insert surplus `order` before 8 AM → **succeeds**
- [ ] Insert surplus `order` after 8 AM → **raises P0002**
- [ ] `validate_daily_cancellation()` before 8 AM → **returns `can_cancel = TRUE`**
- [ ] `validate_daily_cancellation()` after 8 AM → **raises P0005**
- [ ] Cancel all 5 daily orders → weekly order auto-sets `status = 'cancelled'`
- [ ] Complete all 5 daily orders → weekly order auto-sets `status = 'completed'`
- [ ] Cancel 1 daily order → `weekly_orders.total_amount` recalculated automatically
- [ ] Cart item for next week dates → **allowed**
- [ ] Cart item for current week → **rejected (P0014)**
- [ ] Cart item for 3 weeks out → **rejected (P0014)**

### RLS Policies

- [ ] Parent can SELECT own `weekly_orders` ✓
- [ ] Parent cannot SELECT another parent's `weekly_orders` ✗
- [ ] Parent can INSERT `weekly_orders` for linked student ✓
- [ ] Parent cannot INSERT for unlinked student ✗
- [ ] Staff can SELECT all `weekly_orders` ✓
- [ ] Staff can UPDATE `weekly_orders` ✓
- [ ] Authenticated user can view active `surplus_items` ✓
- [ ] Only staff/admin can INSERT/UPDATE/DELETE `surplus_items` ✓
- [ ] No RLS policies reference `wallets` or `topup_sessions`

### Data Migration

- [ ] All pre-existing orders have `weekly_order_id` set (non-cancelled orders)
- [ ] All pre-existing orders have `order_type = 'pre_order'`
- [ ] `weekly_orders` rows backfilled for all historical weeks
- [ ] New settings present: `weekly_cutoff_day`, `weekly_cutoff_time`, `surplus_cutoff_time`, `daily_cancel_cutoff_time`
- [ ] Old settings removed: `order_cutoff_time`, `max_future_days`, `low_stock_threshold`
- [ ] Seed data has no `stock_quantity`, no `'balance'`, no `'topup'`

### Functions & Reporting

- [ ] `get_weekly_order_summary('2026-03-02')` returns correct product counts per day/meal/grade
- [ ] `get_weekly_report('2026-03-02')` returns correct totals and breakdowns
- [ ] `get_admin_dashboard_stats()` includes `weekly_orders_this_week`, `weekly_orders_next_week`
- [ ] All dropped functions no longer exist in `pg_proc`

### Zero References to Removed Objects

```sql
-- All queries below should return 0 rows
SELECT proname FROM pg_proc WHERE proname LIKE '%balance%';
SELECT proname FROM pg_proc WHERE proname LIKE '%stock%';
SELECT proname FROM pg_proc WHERE proname LIKE '%topup%';
SELECT proname FROM pg_proc WHERE proname = 'merge_order_items';
SELECT tablename FROM pg_tables WHERE tablename IN ('wallets','topup_sessions','transactions_legacy');
SELECT column_name, table_name FROM information_schema.columns
  WHERE column_name = 'stock_quantity';
SELECT column_name, table_name FROM information_schema.columns
  WHERE table_name = 'orders' AND column_name = 'meal_period';
```
