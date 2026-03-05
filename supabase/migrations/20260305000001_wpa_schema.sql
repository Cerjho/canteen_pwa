-- =============================================================================
-- Migration 1: Weekly Pre-Order Architecture — Schema Changes
-- =============================================================================
-- Creates new tables, adds new columns, and creates indexes.
-- Non-destructive: no data loss, no DROP operations.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. NEW TABLE: weekly_orders
-- ---------------------------------------------------------------------------
-- Groups a full week (Mon–Fri) of pre-orders for one student.
-- Created when parent submits their weekly order before the Friday 5 PM cutoff.

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

-- Indexes for weekly_orders
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

-- ---------------------------------------------------------------------------
-- 2. NEW TABLE: surplus_items
-- ---------------------------------------------------------------------------
-- Items marked as surplus ("sobra") by staff for today.
-- Parents can order via app or walk in until 8:00 AM.

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

-- Indexes for surplus_items
CREATE INDEX idx_surplus_items_date
  ON surplus_items(scheduled_date);
CREATE INDEX idx_surplus_items_active
  ON surplus_items(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_surplus_items_product_id
  ON surplus_items(product_id);

-- ---------------------------------------------------------------------------
-- 3. MODIFY TABLE: orders — Add weekly link & order type
-- ---------------------------------------------------------------------------

ALTER TABLE orders
  ADD COLUMN weekly_order_id UUID REFERENCES weekly_orders(id) ON DELETE SET NULL,
  ADD COLUMN order_type      TEXT NOT NULL DEFAULT 'pre_order'
    CHECK (order_type IN ('pre_order','surplus','walk_in'));

-- Indexes for new orders columns
CREATE INDEX idx_orders_weekly_order_id
  ON orders(weekly_order_id) WHERE weekly_order_id IS NOT NULL;
CREATE INDEX idx_orders_order_type
  ON orders(order_type);

-- ---------------------------------------------------------------------------
-- 4. MODIFY TABLE: payments — Add weekly order link
-- ---------------------------------------------------------------------------

ALTER TABLE payments
  ADD COLUMN weekly_order_id UUID REFERENCES weekly_orders(id);

CREATE INDEX idx_payments_weekly_order_id
  ON payments(weekly_order_id) WHERE weekly_order_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. MODIFY TABLE: menu_schedules — Add publish status
-- ---------------------------------------------------------------------------

ALTER TABLE menu_schedules
  ADD COLUMN menu_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (menu_status IN ('draft','published','locked'));

COMMENT ON COLUMN menu_schedules.menu_status IS
  'draft     = admin still editing the week''s menu; '
  'published = visible to parents for ordering; '
  'locked    = past cutoff, no further edits allowed.';
