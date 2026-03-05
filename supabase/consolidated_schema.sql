-- ============================================
-- CONSOLIDATED SCHEMA: LOHECA Canteen PWA
-- Generated from all migrations (001_init through 20260305000005_wpa_cleanup)
-- This script creates the FINAL state of the database schema from scratch.
-- Reflects the Weekly Pre-Order Architecture (WPA) refactor.
-- Safe to run on a fresh Supabase project.
-- ============================================

-- ============================================
-- DROP EXISTING TABLES (clean slate for fresh project)
-- Drop in reverse dependency order; CASCADE removes FKs/policies/indexes.
-- ============================================

DROP TABLE IF EXISTS favorites        CASCADE;
DROP TABLE IF EXISTS cart_state        CASCADE;
DROP TABLE IF EXISTS cart_items        CASCADE;
DROP TABLE IF EXISTS audit_logs        CASCADE;
DROP TABLE IF EXISTS date_closures     CASCADE;
DROP TABLE IF EXISTS menu_date_overrides CASCADE;
DROP TABLE IF EXISTS makeup_days       CASCADE;
DROP TABLE IF EXISTS holidays          CASCADE;
DROP TABLE IF EXISTS menu_schedules    CASCADE;
DROP TABLE IF EXISTS invitations       CASCADE;
DROP TABLE IF EXISTS payment_allocations CASCADE;
DROP TABLE IF EXISTS payments           CASCADE;
DROP TABLE IF EXISTS surplus_items      CASCADE;
DROP TABLE IF EXISTS order_items       CASCADE;
DROP TABLE IF EXISTS orders            CASCADE;
DROP TABLE IF EXISTS weekly_orders     CASCADE;
DROP TABLE IF EXISTS parent_students   CASCADE;
DROP TABLE IF EXISTS products          CASCADE;
DROP TABLE IF EXISTS students          CASCADE;
DROP TABLE IF EXISTS user_profiles     CASCADE;
DROP TABLE IF EXISTS system_settings   CASCADE;

DROP VIEW IF EXISTS students_with_parents;

-- ============================================
-- CUSTOM TYPES
-- ============================================

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('awaiting_payment', 'paid', 'timeout', 'refunded', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================
-- HELPER FUNCTIONS (needed before tables for triggers/RLS)
-- ============================================

-- Generic updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Role check: admin only (reads from app_metadata)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    SELECT COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
      FALSE
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Role check: staff or admin (reads from app_metadata)
CREATE OR REPLACE FUNCTION is_staff_or_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    SELECT COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'role') IN ('staff', 'admin'),
      FALSE
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FINANCIAL HARDENING FUNCTIONS
-- ============================================

-- Allocation integrity: SUM(allocated) <= payment.amount_total
CREATE OR REPLACE FUNCTION check_allocation_integrity()
RETURNS TRIGGER AS $$
DECLARE
  v_payment_id UUID;
  v_alloc_sum  NUMERIC(10,2);
  v_total      NUMERIC(10,2);
BEGIN
  IF TG_OP = 'DELETE' THEN v_payment_id := OLD.payment_id;
  ELSE v_payment_id := NEW.payment_id; END IF;

  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_alloc_sum
  FROM payment_allocations WHERE payment_id = v_payment_id;

  SELECT amount_total INTO v_total FROM payments WHERE id = v_payment_id;

  IF v_alloc_sum > v_total THEN
    RAISE EXCEPTION 'Allocation integrity violation: SUM=% > amount_total=% (payment %)',
      v_alloc_sum, v_total, v_payment_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Prevent mutation of core payment fields
CREATE OR REPLACE FUNCTION prevent_amount_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.amount_total IS DISTINCT FROM NEW.amount_total THEN
    RAISE EXCEPTION 'amount_total cannot be modified (payment %).', OLD.id;
  END IF;
  IF OLD.type IS DISTINCT FROM NEW.type THEN
    RAISE EXCEPTION 'type cannot be modified (payment %).', OLD.id;
  END IF;
  IF OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN
    RAISE EXCEPTION 'parent_id cannot be modified (payment %).', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Prevent mutation of allocation fields
CREATE OR REPLACE FUNCTION prevent_allocation_amount_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.allocated_amount IS DISTINCT FROM NEW.allocated_amount THEN
    RAISE EXCEPTION 'allocated_amount cannot be modified (allocation %).', OLD.id;
  END IF;
  IF OLD.payment_id IS DISTINCT FROM NEW.payment_id THEN
    RAISE EXCEPTION 'payment_id cannot be modified (allocation %).', OLD.id;
  END IF;
  IF OLD.order_id IS DISTINCT FROM NEW.order_id THEN
    RAISE EXCEPTION 'order_id cannot be modified (allocation %).', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Status transition guard: only pending -> completed | failed
CREATE OR REPLACE FUNCTION guard_payment_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF OLD.status = 'pending' AND NEW.status IN ('completed', 'failed') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Invalid payment status transition: % -> % (payment %)',
    OLD.status, NEW.status, OLD.id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TABLES
-- ============================================

-- User profiles (all user types: parent, staff, admin)
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  phone_number TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  role TEXT DEFAULT 'parent',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Students (managed by admin)
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  grade_level TEXT NOT NULL,
  section TEXT,
  dietary_restrictions TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Parent <-> Student linking (many-to-many)
CREATE TABLE IF NOT EXISTS parent_students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relationship TEXT DEFAULT 'parent',
  is_primary BOOLEAN DEFAULT TRUE,
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(parent_id, student_id)
);

-- Products (menu items - no stock tracking)
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  category TEXT NOT NULL,
  image_url TEXT,
  available BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Weekly orders (groups Mon-Fri pre-orders for one student)
CREATE TABLE IF NOT EXISTS weekly_orders (
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
  CONSTRAINT uq_weekly_order_student_week UNIQUE (student_id, week_start),
  CONSTRAINT chk_week_start_is_monday CHECK (EXTRACT(ISODOW FROM week_start) = 1)
);

COMMENT ON TABLE weekly_orders IS 'Groups Mon-Fri pre-orders for one student into a single weekly order with unified payment.';
COMMENT ON COLUMN weekly_orders.week_start IS 'Always a Monday - the start of the school week.';
COMMENT ON COLUMN weekly_orders.status IS 'submitted=placed, active=week in progress, completed=all days done, cancelled=fully cancelled.';

-- Orders (daily orders - children of weekly_orders for pre-orders)
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  student_id UUID REFERENCES students(id) ON DELETE RESTRICT,
  client_order_id UUID UNIQUE NOT NULL,
  weekly_order_id UUID REFERENCES weekly_orders(id) ON DELETE SET NULL,
  order_type TEXT NOT NULL DEFAULT 'pre_order'
    CHECK (order_type IN ('pre_order','surplus','walk_in')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('awaiting_payment', 'pending', 'preparing', 'ready', 'completed', 'cancelled')),
  total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('cash', 'gcash', 'paymaya', 'card')),
  payment_status payment_status DEFAULT 'paid',
  payment_due_at TIMESTAMPTZ,
  paymongo_checkout_id TEXT,
  payment_group_id UUID,
  notes TEXT,
  scheduled_for DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Order items
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_at_order NUMERIC(10,2) NOT NULL CHECK (price_at_order >= 0),
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'unavailable')),
  meal_period TEXT DEFAULT 'lunch'
    CHECK (meal_period IN ('morning_snack', 'lunch', 'afternoon_snack')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Surplus items (staff-marked surplus for same-day ordering)
CREATE TABLE IF NOT EXISTS surplus_items (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID    NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  scheduled_date DATE    NOT NULL,
  meal_period    TEXT    CHECK (meal_period IN ('morning_snack','lunch','afternoon_snack')),
  marked_by      UUID    NOT NULL REFERENCES auth.users(id),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_surplus_product_date_meal UNIQUE (product_id, scheduled_date, meal_period)
);

-- Payments (one row per real money movement - no wallet/balance/topup)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('payment', 'refund')),
  amount_total NUMERIC(10,2) NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash', 'gcash', 'paymaya', 'card')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed')),
  weekly_order_id UUID REFERENCES weekly_orders(id),
  external_ref TEXT,
  paymongo_checkout_id TEXT,
  paymongo_payment_id TEXT,
  paymongo_refund_id TEXT,
  payment_group_id TEXT,
  reference_id TEXT,
  original_payment_id UUID REFERENCES payments(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payment allocations (links a payment to one or more orders)
CREATE TABLE IF NOT EXISTS payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  allocated_amount NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Invitations (for user registration)
CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'parent',
  used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMPTZ,
  used_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  created_by UUID REFERENCES auth.users(id)
);

-- Menu schedules (weekly day-of-week pattern + publish status)
CREATE TABLE IF NOT EXISTS menu_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 1 AND day_of_week <= 5),
  scheduled_date DATE,
  is_active BOOLEAN DEFAULT TRUE,
  menu_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (menu_status IN ('draft','published','locked')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN menu_schedules.menu_status IS 'draft=admin editing, published=visible to parents, locked=past cutoff.';

-- Holidays
CREATE TABLE IF NOT EXISTS holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  date DATE NOT NULL UNIQUE,
  description TEXT,
  is_recurring BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Makeup days (Saturday make-up classes when canteen is open)
CREATE TABLE IF NOT EXISTS makeup_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT 'Make-up Class',
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  CONSTRAINT makeup_days_saturday_only CHECK (EXTRACT(DOW FROM date) = 6)
);

-- Menu date overrides (override the weekly template for specific dates)
CREATE TABLE IF NOT EXISTS menu_date_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, scheduled_date)
);

-- Date closures (close canteen on specific dates without declaring a holiday)
CREATE TABLE IF NOT EXISTS date_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  closure_date DATE NOT NULL UNIQUE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- System settings (key-value configuration)
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

-- Default system settings (weekly pre-order architecture)
INSERT INTO system_settings (key, value, description) VALUES
  ('canteen_name',            '"LOHECA Canteen"',                    'Name of the canteen displayed in the app'),
  ('operating_hours',         '{"open": "07:00", "close": "15:00"}', 'Operating hours for the canteen'),
  ('allow_future_orders',     'true',                                'Allow parents to order for future dates'),
  ('auto_complete_orders',    'false',                                'Automatically complete orders after pickup'),
  ('notification_email',      'null',                                 'Email for admin notifications'),
  ('maintenance_mode',        'false',                                'Put the app in maintenance mode'),
  ('weekly_cutoff_day',       '"friday"',                             'Day of week when weekly ordering window closes'),
  ('weekly_cutoff_time',      '"17:00"',                              'Time on cutoff day when ordering closes - 24h, Asia/Manila TZ'),
  ('surplus_cutoff_time',     '"08:00"',                              'Daily deadline for surplus/walk-in orders - 24h, Asia/Manila TZ'),
  ('daily_cancel_cutoff_time','"08:00"',                              'Daily deadline for parents to cancel individual days - 24h, Asia/Manila TZ')
ON CONFLICT (key) DO NOTHING;

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cart items (per user, per student, per product, per date)
CREATE TABLE IF NOT EXISTS cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  scheduled_for DATE NOT NULL DEFAULT CURRENT_DATE,
  meal_period TEXT NOT NULL DEFAULT 'lunch'
    CHECK (meal_period IN ('morning_snack', 'lunch', 'afternoon_snack')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT cart_items_user_student_product_date_meal_key
    UNIQUE (user_id, student_id, product_id, scheduled_for, meal_period)
);

-- Cart state (selected student, notes, payment method per user)
CREATE TABLE IF NOT EXISTS cart_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  notes TEXT DEFAULT '',
  payment_method TEXT DEFAULT 'cash'
    CHECK (payment_method IN ('cash', 'gcash', 'paymaya', 'card')),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Favorites (user <-> product)
CREATE TABLE IF NOT EXISTS favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, product_id)
);

-- ============================================
-- INDEXES
-- ============================================

-- user_profiles
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);

-- students
CREATE INDEX IF NOT EXISTS idx_students_student_id ON students(student_id);
CREATE INDEX IF NOT EXISTS idx_students_grade_level ON students(grade_level);
CREATE INDEX IF NOT EXISTS idx_students_is_active ON students(is_active);
CREATE INDEX IF NOT EXISTS idx_students_name ON students(last_name, first_name);

-- parent_students
CREATE INDEX IF NOT EXISTS idx_parent_students_parent_id ON parent_students(parent_id);
CREATE INDEX IF NOT EXISTS idx_parent_students_student_id ON parent_students(student_id);

-- products
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_available ON products(available);

-- weekly_orders
CREATE INDEX IF NOT EXISTS idx_weekly_orders_parent_id ON weekly_orders(parent_id);
CREATE INDEX IF NOT EXISTS idx_weekly_orders_student_id ON weekly_orders(student_id);
CREATE INDEX IF NOT EXISTS idx_weekly_orders_week_start ON weekly_orders(week_start);
CREATE INDEX IF NOT EXISTS idx_weekly_orders_status ON weekly_orders(status);
CREATE INDEX IF NOT EXISTS idx_weekly_orders_payment_status
  ON weekly_orders(payment_status) WHERE payment_status = 'awaiting_payment';
CREATE INDEX IF NOT EXISTS idx_weekly_orders_payment_due_at
  ON weekly_orders(payment_due_at) WHERE payment_due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_weekly_orders_paymongo_checkout_id
  ON weekly_orders(paymongo_checkout_id) WHERE paymongo_checkout_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_weekly_orders_payment_group
  ON weekly_orders(payment_group_id) WHERE payment_group_id IS NOT NULL;

-- orders
CREATE INDEX IF NOT EXISTS idx_orders_parent_id ON orders(parent_id);
CREATE INDEX IF NOT EXISTS idx_orders_student_id ON orders(student_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_client_order_id ON orders(client_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_scheduled_for_status ON orders(scheduled_for, status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status
  ON orders(payment_status) WHERE payment_status = 'awaiting_payment';
CREATE INDEX IF NOT EXISTS idx_orders_payment_due_at
  ON orders(payment_due_at) WHERE payment_due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_weekly_order_id
  ON orders(weekly_order_id) WHERE weekly_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_order_type ON orders(order_type);

-- Unique partial index: prevent duplicate active orders per student+date
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_order_per_student_date
  ON orders(student_id, scheduled_for)
  WHERE status NOT IN ('cancelled');

-- Composite lookup index for fast slot queries
CREATE INDEX IF NOT EXISTS idx_orders_student_date
  ON orders(student_id, scheduled_for);

-- order_items
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

-- surplus_items
CREATE INDEX IF NOT EXISTS idx_surplus_items_date ON surplus_items(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_surplus_items_active ON surplus_items(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_surplus_items_product_id ON surplus_items(product_id);

-- payments
CREATE INDEX IF NOT EXISTS idx_payments_parent_id ON payments(parent_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_type ON payments(type);
CREATE INDEX IF NOT EXISTS idx_payments_payment_group_id
  ON payments(payment_group_id) WHERE payment_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_paymongo_checkout_id
  ON payments(paymongo_checkout_id) WHERE paymongo_checkout_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_paymongo_payment_id
  ON payments(paymongo_payment_id) WHERE paymongo_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_original_payment_id
  ON payments(original_payment_id) WHERE original_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_weekly_order_id
  ON payments(weekly_order_id) WHERE weekly_order_id IS NOT NULL;

-- Unique indexes for webhook idempotency
CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_paymongo_payment_id
  ON payments(paymongo_payment_id) WHERE paymongo_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_paymongo_checkout_id
  ON payments(paymongo_checkout_id) WHERE paymongo_checkout_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_paymongo_refund_id
  ON payments(paymongo_refund_id) WHERE paymongo_refund_id IS NOT NULL;

-- payment_allocations
CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment_id ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_order_id ON payment_allocations(order_id);

-- orders (PayMongo)
CREATE INDEX IF NOT EXISTS idx_orders_paymongo_checkout_id
  ON orders(paymongo_checkout_id) WHERE paymongo_checkout_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_payment_group
  ON orders(payment_group_id) WHERE payment_group_id IS NOT NULL;

-- invitations
CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations(code);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);

-- menu_schedules
CREATE INDEX IF NOT EXISTS idx_menu_schedules_day ON menu_schedules(day_of_week);
CREATE INDEX IF NOT EXISTS idx_menu_schedules_product ON menu_schedules(product_id);
CREATE INDEX IF NOT EXISTS idx_menu_schedules_active
  ON menu_schedules(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_menu_schedules_date ON menu_schedules(scheduled_date);
CREATE UNIQUE INDEX IF NOT EXISTS menu_schedules_product_date_unique
  ON menu_schedules(product_id, scheduled_date) WHERE scheduled_date IS NOT NULL;

-- holidays
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
CREATE INDEX IF NOT EXISTS idx_holidays_recurring
  ON holidays(is_recurring) WHERE is_recurring = TRUE;

-- makeup_days
CREATE INDEX IF NOT EXISTS idx_makeup_days_date ON makeup_days(date);

-- menu_date_overrides
CREATE INDEX IF NOT EXISTS idx_menu_date_overrides_date ON menu_date_overrides(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_menu_date_overrides_active
  ON menu_date_overrides(is_active) WHERE is_active = TRUE;

-- audit_logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- cart_items
CREATE INDEX IF NOT EXISTS idx_cart_items_user_id ON cart_items(user_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_student_id ON cart_items(student_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_scheduled_for ON cart_items(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_cart_items_user_date ON cart_items(user_id, scheduled_for);

-- favorites
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_product_id ON favorites(product_id);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Generate a unique student ID (e.g., "26-00001")
CREATE OR REPLACE FUNCTION generate_student_id()
RETURNS TEXT AS $$
DECLARE
  new_id TEXT;
  year_part TEXT;
  seq_num INTEGER;
BEGIN
  year_part := TO_CHAR(CURRENT_DATE, 'YY');

  SELECT COALESCE(MAX(
    CASE
      WHEN student_id ~ ('^' || year_part || '-[0-9]+$')
      THEN CAST(SPLIT_PART(student_id, '-', 2) AS INTEGER)
      ELSE 0
    END
  ), 0) + 1
  INTO seq_num
  FROM students;

  new_id := year_part || '-' || LPAD(seq_num::TEXT, 5, '0');
  RETURN new_id;
END;
$$ LANGUAGE plpgsql;

-- Check if a given date is a holiday
CREATE OR REPLACE FUNCTION is_holiday(check_date DATE DEFAULT CURRENT_DATE)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM holidays WHERE date = check_date);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if canteen is open on a given date (weekday + not a holiday)
CREATE OR REPLACE FUNCTION is_canteen_open(check_date DATE DEFAULT CURRENT_DATE)
RETURNS BOOLEAN AS $$
DECLARE
  day_num INTEGER;
BEGIN
  day_num := EXTRACT(DOW FROM check_date)::INTEGER;
  RETURN day_num >= 1 AND day_num <= 5 AND NOT is_holiday(check_date);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get menu for a specific calendar date
CREATE OR REPLACE FUNCTION get_menu_for_date(target_date DATE)
RETURNS TABLE (
  product_id UUID,
  product_name TEXT,
  product_description TEXT,
  product_price NUMERIC,
  product_category TEXT,
  product_image_url TEXT,
  product_available BOOLEAN
) AS $$
DECLARE
  day_num INTEGER;
BEGIN
  day_num := EXTRACT(DOW FROM target_date);

  IF day_num = 0 OR day_num = 6 THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM holidays WHERE date = target_date) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    p.id, p.name, p.description, p.price,
    p.category, p.image_url, p.available
  FROM products p
  INNER JOIN menu_schedules ms ON p.id = ms.product_id
  WHERE ms.day_of_week = day_num
    AND ms.is_active = true
    AND p.available = true
  ORDER BY p.category, p.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Sync user role from auth.users app_metadata -> user_profiles.role
CREATE OR REPLACE FUNCTION sync_user_role()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE user_profiles
  SET role = COALESCE(NEW.raw_app_meta_data->>'role', role, 'parent')
  WHERE id = NEW.id;
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'sync_user_role failed for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Audit log trigger function
CREATE OR REPLACE FUNCTION log_audit_action()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_data)
    VALUES (auth.uid(), 'CREATE', TG_TABLE_NAME, NEW.id, to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_data, new_data)
    VALUES (auth.uid(), 'UPDATE', TG_TABLE_NAME, NEW.id, to_jsonb(OLD), to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_data)
    VALUES (auth.uid(), 'DELETE', TG_TABLE_NAME, OLD.id, to_jsonb(OLD));
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get daily sales summary for a date range
CREATE OR REPLACE FUNCTION get_daily_sales_summary(start_date DATE, end_date DATE)
RETURNS TABLE (
  sale_date DATE,
  total_revenue NUMERIC,
  order_count BIGINT,
  avg_order_value NUMERIC,
  cash_revenue NUMERIC,
  gcash_revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE(o.created_at) as sale_date,
    COALESCE(SUM(o.total_amount), 0) as total_revenue,
    COUNT(*) as order_count,
    COALESCE(AVG(o.total_amount), 0) as avg_order_value,
    COALESCE(SUM(CASE WHEN o.payment_method = 'cash'  THEN o.total_amount ELSE 0 END), 0) as cash_revenue,
    COALESCE(SUM(CASE WHEN o.payment_method = 'gcash' THEN o.total_amount ELSE 0 END), 0) as gcash_revenue
  FROM orders o
  WHERE DATE(o.created_at) BETWEEN start_date AND end_date
    AND o.status NOT IN ('cancelled')
  GROUP BY DATE(o.created_at)
  ORDER BY sale_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get top-selling products for a date range
CREATE OR REPLACE FUNCTION get_top_products(start_date DATE, end_date DATE, limit_count INT DEFAULT 10)
RETURNS TABLE (
  product_id UUID,
  product_name TEXT,
  category TEXT,
  total_quantity BIGINT,
  total_revenue NUMERIC,
  order_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id as product_id,
    p.name as product_name,
    p.category,
    COALESCE(SUM(oi.quantity), 0) as total_quantity,
    COALESCE(SUM(oi.quantity * oi.price_at_order), 0) as total_revenue,
    COUNT(DISTINCT o.id) as order_count
  FROM products p
  LEFT JOIN order_items oi ON oi.product_id = p.id
  LEFT JOIN orders o ON o.id = oi.order_id
    AND DATE(o.created_at) BETWEEN start_date AND end_date
    AND o.status NOT IN ('cancelled')
  GROUP BY p.id, p.name, p.category
  ORDER BY total_quantity DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admin dashboard stats (with weekly order + surplus metrics)
DROP FUNCTION IF EXISTS get_admin_dashboard_stats(DATE);
CREATE OR REPLACE FUNCTION get_admin_dashboard_stats(target_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
  today_orders BIGINT,
  today_revenue NUMERIC,
  pending_orders BIGINT,
  preparing_orders BIGINT,
  ready_orders BIGINT,
  awaiting_payment_orders BIGINT,
  completed_today BIGINT,
  cancelled_today BIGINT,
  total_parents BIGINT,
  total_students BIGINT,
  total_products BIGINT,
  yesterday_orders BIGINT,
  yesterday_revenue NUMERIC,
  week_orders BIGINT,
  week_revenue NUMERIC,
  month_orders BIGINT,
  month_revenue NUMERIC,
  future_orders BIGINT,
  active_parents_today BIGINT,
  weekly_orders_this_week BIGINT,
  weekly_orders_next_week BIGINT,
  surplus_orders_today BIGINT
) AS $$
DECLARE
  yesterday_date DATE := target_date - INTERVAL '1 day';
  week_start_d DATE := date_trunc('week', target_date)::DATE;
  next_week_start DATE := week_start_d + INTERVAL '7 days';
  month_start DATE := date_trunc('month', target_date)::DATE;
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM orders WHERE scheduled_for = target_date)::BIGINT,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE scheduled_for = target_date AND status != 'cancelled')::NUMERIC,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for = target_date AND status = 'pending')::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for = target_date AND status = 'preparing')::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for = target_date AND status = 'ready')::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for = target_date AND status = 'awaiting_payment')::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for = target_date AND status = 'completed')::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for = target_date AND status = 'cancelled')::BIGINT,
    (SELECT COUNT(*) FROM user_profiles WHERE role = 'parent')::BIGINT,
    (SELECT COUNT(*) FROM students WHERE is_active = true)::BIGINT,
    (SELECT COUNT(*) FROM products WHERE available = true)::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for = yesterday_date)::BIGINT,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE scheduled_for = yesterday_date AND status != 'cancelled')::NUMERIC,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for >= week_start_d AND scheduled_for <= target_date)::BIGINT,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE scheduled_for >= week_start_d AND scheduled_for <= target_date AND status != 'cancelled')::NUMERIC,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for >= month_start AND scheduled_for <= target_date)::BIGINT,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE scheduled_for >= month_start AND scheduled_for <= target_date AND status != 'cancelled')::NUMERIC,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for > target_date AND status != 'cancelled')::BIGINT,
    (SELECT COUNT(DISTINCT parent_id) FROM orders WHERE scheduled_for = target_date)::BIGINT,
    (SELECT COUNT(*) FROM weekly_orders WHERE week_start = week_start_d AND status != 'cancelled')::BIGINT,
    (SELECT COUNT(*) FROM weekly_orders WHERE week_start = next_week_start AND status != 'cancelled')::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for = target_date AND order_type IN ('surplus','walk_in') AND status != 'cancelled')::BIGINT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_admin_dashboard_stats(DATE) TO authenticated;

-- Hourly order distribution for a given day
CREATE OR REPLACE FUNCTION get_hourly_distribution(target_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
  hour INT,
  order_count BIGINT,
  revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    EXTRACT(HOUR FROM o.created_at)::INT as hour,
    COUNT(*) as order_count,
    COALESCE(SUM(o.total_amount), 0) as revenue
  FROM orders o
  WHERE DATE(o.created_at) = target_date
    AND o.status != 'cancelled'
  GROUP BY EXTRACT(HOUR FROM o.created_at)
  ORDER BY hour;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- WEEKLY PRE-ORDER FUNCTIONS
-- ============================================

-- Cart-item date validation (enforces next-orderable-week window)
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

  IF NEW.scheduled_for < v_today THEN
    RAISE EXCEPTION 'Cannot add items for past dates.' USING ERRCODE = 'P0010';
  END IF;

  IF v_dow = 7 THEN
    RAISE EXCEPTION 'Canteen is closed on Sundays.' USING ERRCODE = 'P0011';
  END IF;

  IF v_dow = 6 THEN
    IF NOT EXISTS (SELECT 1 FROM makeup_days WHERE date = NEW.scheduled_for) THEN
      RAISE EXCEPTION 'Canteen is closed on Saturdays unless it is a makeup day.'
        USING ERRCODE = 'P0012';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM holidays
    WHERE (date = NEW.scheduled_for)
       OR (is_recurring
           AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM NEW.scheduled_for)
           AND EXTRACT(DAY   FROM date) = EXTRACT(DAY   FROM NEW.scheduled_for))
  ) THEN
    RAISE EXCEPTION 'Canteen is closed on this holiday.' USING ERRCODE = 'P0013';
  END IF;

  v_next_monday := v_today + ((8 - EXTRACT(ISODOW FROM v_today)::INT) % 7 + 1);

  SELECT COALESCE(
    (SELECT value #>> '{}' FROM system_settings WHERE key = 'weekly_cutoff_time'),
    '17:00'
  ) INTO v_cutoff_time;

  v_this_friday := v_today + (5 - EXTRACT(ISODOW FROM v_today)::INT);

  IF EXTRACT(ISODOW FROM v_today) BETWEEN 1 AND 5 THEN
    v_cutoff_ts := (v_this_friday::TEXT || ' ' || v_cutoff_time)::TIMESTAMPTZ
                   AT TIME ZONE 'Asia/Manila';
    IF v_now_ph > v_cutoff_ts THEN
      v_next_monday := v_next_monday + INTERVAL '7 days';
    END IF;
  END IF;

  v_next_friday := v_next_monday + INTERVAL '4 days';

  IF NEW.scheduled_for < v_next_monday OR NEW.scheduled_for > v_next_friday THEN
    RAISE EXCEPTION 'Items can only be added for next week (% to %).', v_next_monday, v_next_friday
      USING ERRCODE = 'P0014';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Validate weekly order cutoff (Friday 5 PM Manila TZ)
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

-- Validate surplus/walk-in order cutoff (8 AM same day)
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

-- Validate daily cancellation RPC
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
    RAISE EXCEPTION 'Cannot cancel - past the % cancellation deadline for %.',
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

-- Auto-transition weekly order status based on child order completion
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

-- Recalculate weekly order total when a daily order is cancelled
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

-- Kitchen prep aggregation - weekly order summary by day/meal/product
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

-- Weekly reporting aggregation for admin
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

-- Clean up cart items for past dates
CREATE OR REPLACE FUNCTION cleanup_past_cart_items()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
  today_ph DATE;
BEGIN
  today_ph := (NOW() AT TIME ZONE 'Asia/Manila')::DATE;
  DELETE FROM cart_items WHERE scheduled_for < today_ph;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Order status transition validation
CREATE OR REPLACE FUNCTION validate_order_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  CASE OLD.status
    WHEN 'awaiting_payment' THEN
      IF NEW.status NOT IN ('pending', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transition from awaiting_payment to %', NEW.status;
      END IF;
    WHEN 'pending' THEN
      IF NEW.status NOT IN ('preparing', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transition from pending to %', NEW.status;
      END IF;
    WHEN 'preparing' THEN
      IF NEW.status NOT IN ('ready', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transition from preparing to %', NEW.status;
      END IF;
    WHEN 'ready' THEN
      IF NEW.status NOT IN ('completed', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transition from ready to %', NEW.status;
      END IF;
    WHEN 'completed' THEN
      RAISE EXCEPTION 'Cannot transition from completed status';
    WHEN 'cancelled' THEN
      RAISE EXCEPTION 'Cannot transition from cancelled status';
    ELSE
      NULL;
  END CASE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGERS
-- ============================================

-- updated_at auto-stamps
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_students_updated_at ON students;
CREATE TRIGGER update_students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_weekly_orders_updated_at ON weekly_orders;
CREATE TRIGGER update_weekly_orders_updated_at
  BEFORE UPDATE ON weekly_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_menu_schedules_timestamp ON menu_schedules;
CREATE TRIGGER update_menu_schedules_timestamp
  BEFORE UPDATE ON menu_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_cart_items_updated_at ON cart_items;
CREATE TRIGGER update_cart_items_updated_at
  BEFORE UPDATE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Sync role from auth.users app_metadata -> user_profiles on UPDATE only
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.raw_app_meta_data->>'role' IS DISTINCT FROM NEW.raw_app_meta_data->>'role')
  EXECUTE FUNCTION sync_user_role();

-- Audit triggers
DROP TRIGGER IF EXISTS audit_products ON products;
CREATE TRIGGER audit_products
  AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION log_audit_action();

DROP TRIGGER IF EXISTS audit_orders_status ON orders;
CREATE TRIGGER audit_orders_status
  AFTER UPDATE ON orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION log_audit_action();

-- Order status transition validation trigger
DROP TRIGGER IF EXISTS validate_order_status_trigger ON orders;
CREATE TRIGGER validate_order_status_trigger
  BEFORE UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION validate_order_status_transition();

-- Cart validation trigger (next-orderable-week enforcement)
DROP TRIGGER IF EXISTS validate_cart_item_date_trigger ON cart_items;
CREATE TRIGGER validate_cart_item_date_trigger
  BEFORE INSERT OR UPDATE OF scheduled_for ON cart_items
  FOR EACH ROW
  EXECUTE FUNCTION validate_cart_item_date();

-- Weekly pre-order triggers
DROP TRIGGER IF EXISTS trg_validate_weekly_order_cutoff ON weekly_orders;
CREATE TRIGGER trg_validate_weekly_order_cutoff
  BEFORE INSERT ON weekly_orders
  FOR EACH ROW
  EXECUTE FUNCTION validate_weekly_order_cutoff();

DROP TRIGGER IF EXISTS trg_validate_surplus_order_cutoff ON orders;
CREATE TRIGGER trg_validate_surplus_order_cutoff
  BEFORE INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION validate_surplus_order_cutoff();

DROP TRIGGER IF EXISTS trg_transition_weekly_order_status ON orders;
CREATE TRIGGER trg_transition_weekly_order_status
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  WHEN (NEW.weekly_order_id IS NOT NULL)
  EXECUTE FUNCTION transition_weekly_order_status();

DROP TRIGGER IF EXISTS trg_recalculate_weekly_order_total ON orders;
CREATE TRIGGER trg_recalculate_weekly_order_total
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status != 'cancelled')
  EXECUTE FUNCTION recalculate_weekly_order_total();

-- Financial hardening triggers

DROP TRIGGER IF EXISTS trg_check_allocation_integrity ON payment_allocations;
CREATE CONSTRAINT TRIGGER trg_check_allocation_integrity
  AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_allocation_integrity();

DROP TRIGGER IF EXISTS trg_prevent_amount_mutation ON payments;
CREATE TRIGGER trg_prevent_amount_mutation
  BEFORE UPDATE ON payments FOR EACH ROW
  EXECUTE FUNCTION prevent_amount_mutation();

DROP TRIGGER IF EXISTS trg_prevent_allocation_amount_mutation ON payment_allocations;
CREATE TRIGGER trg_prevent_allocation_amount_mutation
  BEFORE UPDATE ON payment_allocations FOR EACH ROW
  EXECUTE FUNCTION prevent_allocation_amount_mutation();

DROP TRIGGER IF EXISTS trg_guard_payment_status ON payments;
CREATE TRIGGER trg_guard_payment_status
  BEFORE UPDATE OF status ON payments FOR EACH ROW
  EXECUTE FUNCTION guard_payment_status_transition();

-- ============================================
-- ENABLE ROW LEVEL SECURITY ON ALL TABLES
-- ============================================

ALTER TABLE user_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE students         ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_students  ENABLE ROW LEVEL SECURITY;
ALTER TABLE products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_orders    ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE surplus_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_schedules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays         ENABLE ROW LEVEL SECURITY;
ALTER TABLE makeup_days      ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_date_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE date_closures    ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_state       ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites        ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES
-- ============================================

-- user_profiles
CREATE POLICY "Users can view own profile" ON user_profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON user_profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can insert own profile on signup" ON user_profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Staff can view all user profiles" ON user_profiles FOR SELECT USING (is_staff_or_admin());
CREATE POLICY "Admin can update any user profile" ON user_profiles FOR UPDATE USING (is_admin());

-- students
CREATE POLICY "Admins can manage all students" ON students FOR ALL USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "Staff can view all students" ON students FOR SELECT USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('staff', 'admin'));
CREATE POLICY "Parents can view their linked students" ON students FOR SELECT USING (id IN (SELECT student_id FROM parent_students WHERE parent_id = auth.uid()));

-- parent_students
CREATE POLICY "Parents can view their own links" ON parent_students FOR SELECT USING (parent_id = auth.uid());
CREATE POLICY "Parents can link unlinked students" ON parent_students FOR INSERT WITH CHECK (parent_id = auth.uid() AND NOT EXISTS (SELECT 1 FROM parent_students ps2 WHERE ps2.student_id = parent_students.student_id));
CREATE POLICY "Admins can manage all links" ON parent_students FOR ALL USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "Staff can view all links" ON parent_students FOR SELECT USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('staff', 'admin'));

-- products
CREATE POLICY "Anyone can view available products" ON products FOR SELECT USING (TRUE);
CREATE POLICY "Staff can insert products" ON products FOR INSERT WITH CHECK (is_staff_or_admin());
CREATE POLICY "Staff can update products" ON products FOR UPDATE USING (is_staff_or_admin());
CREATE POLICY "Admin can delete products" ON products FOR DELETE USING (is_admin());

-- weekly_orders
CREATE POLICY "Parents view own weekly orders" ON weekly_orders FOR SELECT USING (parent_id = auth.uid());
CREATE POLICY "Parents create own weekly orders" ON weekly_orders FOR INSERT WITH CHECK (parent_id = auth.uid());
CREATE POLICY "Parents update own weekly orders" ON weekly_orders FOR UPDATE USING (parent_id = auth.uid());
CREATE POLICY "Staff read all weekly orders" ON weekly_orders FOR SELECT USING (is_staff_or_admin());
CREATE POLICY "Staff update all weekly orders" ON weekly_orders FOR UPDATE USING (is_staff_or_admin());

-- orders
CREATE POLICY "Parents can view their orders" ON orders FOR SELECT USING (parent_id = auth.uid());
CREATE POLICY "Parents can create orders" ON orders FOR INSERT WITH CHECK (parent_id = auth.uid() AND student_id IN (SELECT ps.student_id FROM parent_students ps WHERE ps.parent_id = auth.uid()));
CREATE POLICY "Staff can view all orders" ON orders FOR SELECT USING (is_staff_or_admin());
CREATE POLICY "Staff can update order status" ON orders FOR UPDATE USING (is_staff_or_admin());

-- order_items
CREATE POLICY "Parents can view own order items" ON order_items FOR SELECT USING (EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.parent_id = auth.uid()));
CREATE POLICY "Staff can view all order items" ON order_items FOR SELECT USING (is_staff_or_admin());

-- surplus_items
CREATE POLICY "Authenticated view surplus items" ON surplus_items FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff create surplus items" ON surplus_items FOR INSERT WITH CHECK (is_staff_or_admin());
CREATE POLICY "Staff update surplus items" ON surplus_items FOR UPDATE USING (is_staff_or_admin());
CREATE POLICY "Admin delete surplus items" ON surplus_items FOR DELETE USING (is_admin());

-- payments
CREATE POLICY "Parents can view own payments" ON payments FOR SELECT USING (parent_id = auth.uid());
CREATE POLICY "Staff can view all payments" ON payments FOR SELECT USING (is_staff_or_admin());
CREATE POLICY "Admin can insert payments" ON payments FOR INSERT WITH CHECK (is_admin());

-- payment_allocations
CREATE POLICY "Parents can view own allocations" ON payment_allocations FOR SELECT USING (EXISTS (SELECT 1 FROM payments p WHERE p.id = payment_id AND p.parent_id = auth.uid()));
CREATE POLICY "Staff can view all allocations" ON payment_allocations FOR SELECT USING (is_staff_or_admin());

-- invitations
CREATE POLICY "Admins can manage invitations" ON invitations FOR ALL USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "Admin can read invitations" ON invitations FOR SELECT USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- menu_schedules
CREATE POLICY "Anyone can view menu schedules" ON menu_schedules FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "Admin can manage menu schedules" ON menu_schedules FOR ALL TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- holidays
CREATE POLICY "Anyone can view holidays" ON holidays FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "Admin can insert holidays" ON holidays FOR INSERT TO authenticated WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "Admin can update holidays" ON holidays FOR UPDATE TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "Admin can delete holidays" ON holidays FOR DELETE TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- makeup_days
CREATE POLICY "Anyone can view makeup days" ON makeup_days FOR SELECT USING (true);
CREATE POLICY "Admins can insert makeup days" ON makeup_days FOR INSERT WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "Admins can update makeup days" ON makeup_days FOR UPDATE USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "Admins can delete makeup days" ON makeup_days FOR DELETE USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- menu_date_overrides
CREATE POLICY "Anyone can view menu date overrides" ON menu_date_overrides FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "Admin can manage menu date overrides" ON menu_date_overrides FOR ALL TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- date_closures
CREATE POLICY "Anyone can view date closures" ON date_closures FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "Admin can manage date closures" ON date_closures FOR ALL TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- system_settings
CREATE POLICY "Anyone can view settings" ON system_settings FOR SELECT USING (TRUE);
CREATE POLICY "Admins can update settings" ON system_settings FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admins can insert settings" ON system_settings FOR INSERT WITH CHECK (is_admin());

-- audit_logs
CREATE POLICY "Admins can view audit logs" ON audit_logs FOR SELECT USING (is_admin());
CREATE POLICY "Staff and admin can insert audit logs" ON audit_logs FOR INSERT WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff'));

-- cart_items
CREATE POLICY "Users can view own cart items" ON cart_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own cart items" ON cart_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own cart items" ON cart_items FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own cart items" ON cart_items FOR DELETE USING (auth.uid() = user_id);

-- cart_state
CREATE POLICY "Users can view own cart state" ON cart_state FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own cart state" ON cart_state FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own cart state" ON cart_state FOR UPDATE USING (auth.uid() = user_id);

-- favorites
CREATE POLICY "Users can view own favorites" ON favorites FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own favorites" ON favorites FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own favorites" ON favorites FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- VIEWS
-- ============================================

CREATE OR REPLACE VIEW students_with_parents AS
SELECT
  s.*,
  ps.parent_id,
  up.first_name  AS parent_first_name,
  up.last_name   AS parent_last_name,
  up.email        AS parent_email,
  up.phone_number AS parent_phone
FROM students s
LEFT JOIN parent_students ps ON ps.student_id = s.id
LEFT JOIN user_profiles up   ON up.id = ps.parent_id;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON COLUMN orders.scheduled_for   IS 'The date when the order should be fulfilled.';
COMMENT ON COLUMN orders.status          IS 'awaiting_payment=cash order waiting, pending=ready for kitchen, preparing=being made, ready=pickup, completed=done, cancelled=cancelled';
COMMENT ON COLUMN orders.payment_status  IS 'awaiting_payment=cash not received, paid=confirmed, timeout=auto-cancelled, refunded=money returned';
COMMENT ON COLUMN orders.payment_due_at  IS 'Deadline for cash payment. After this time, order can be auto-cancelled.';
COMMENT ON COLUMN orders.order_type      IS 'pre_order=weekly pre-order, surplus=surplus item order, walk_in=staff walk-in order.';
COMMENT ON COLUMN cart_items.scheduled_for IS 'Must be within the next orderable week (Mon-Fri after cutoff).';
COMMENT ON COLUMN holidays.is_recurring  IS 'If true, the holiday recurs every year on the same date';
COMMENT ON TABLE  makeup_days            IS 'Stores Saturday make-up class days when canteen should be open';
COMMENT ON FUNCTION get_admin_dashboard_stats IS 'Admin dashboard stats with weekly order and surplus metrics.';

-- ============================================
-- END OF CONSOLIDATED SCHEMA
-- Post-refactor: 21 tables, ~29 functions, ~21 triggers, ~78 indexes, ~65 RLS policies
-- ============================================
