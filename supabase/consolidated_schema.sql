-- ============================================
-- CONSOLIDATED SCHEMA: LOHECA Canteen PWA
-- Generated from all migrations (001_init through 20260219_secure_role_app_metadata)
-- This script creates the FINAL state of the database schema from scratch.
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
DROP TABLE IF EXISTS transactions_legacy CASCADE;
DROP TABLE IF EXISTS order_items       CASCADE;
DROP TABLE IF EXISTS orders            CASCADE;
DROP TABLE IF EXISTS parent_students   CASCADE;
DROP TABLE IF EXISTS products          CASCADE;
DROP TABLE IF EXISTS students          CASCADE;
DROP TABLE IF EXISTS wallets           CASCADE;
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

-- Allocation integrity: SUM(allocated) ≤ payment.amount_total
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

-- Status transition guard: only pending → completed | failed
CREATE OR REPLACE FUNCTION guard_payment_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF OLD.status = 'pending' AND NEW.status IN ('completed', 'failed') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Invalid payment status transition: % → % (payment %)',
    OLD.status, NEW.status, OLD.id;
END;
$$ LANGUAGE plpgsql;

-- Atomic wallet debit + payment + allocations
CREATE OR REPLACE FUNCTION deduct_balance_with_payment(
  p_parent_id UUID, p_expected_balance NUMERIC(10,2), p_amount NUMERIC(10,2),
  p_order_ids UUID[], p_order_amounts NUMERIC(10,2)[]
) RETURNS UUID AS $$
DECLARE v_payment_id UUID; v_new_balance NUMERIC(10,2); v_rows INT; i INT;
BEGIN
  IF array_length(p_order_ids,1) != array_length(p_order_amounts,1) THEN
    RAISE EXCEPTION 'order_ids and order_amounts must match'; END IF;
  v_new_balance := p_expected_balance - p_amount;
  IF v_new_balance < 0 THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
  UPDATE wallets SET balance = v_new_balance, updated_at = NOW()
    WHERE user_id = p_parent_id AND balance = p_expected_balance;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'Balance changed concurrently'; END IF;
  INSERT INTO payments (parent_id, type, amount_total, method, status)
    VALUES (p_parent_id, 'payment', p_amount, 'balance', 'completed')
    RETURNING id INTO v_payment_id;
  FOR i IN 1..array_length(p_order_ids,1) LOOP
    INSERT INTO payment_allocations (payment_id, order_id, allocated_amount)
      VALUES (v_payment_id, p_order_ids[i], p_order_amounts[i]);
  END LOOP;
  RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql;

-- Atomic wallet credit + payment record (refund/topup)
CREATE OR REPLACE FUNCTION credit_balance_with_payment(
  p_parent_id UUID, p_amount NUMERIC(10,2), p_type TEXT, p_method TEXT,
  p_reference_id TEXT DEFAULT NULL, p_order_id UUID DEFAULT NULL,
  p_external_ref TEXT DEFAULT NULL, p_paymongo_refund_id TEXT DEFAULT NULL,
  p_paymongo_payment_id TEXT DEFAULT NULL, p_paymongo_checkout_id TEXT DEFAULT NULL,
  p_original_payment_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE v_payment_id UUID; v_current NUMERIC(10,2);
BEGIN
  SELECT balance INTO v_current FROM wallets WHERE user_id = p_parent_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO wallets (user_id, balance) VALUES (p_parent_id, 0); v_current := 0;
  END IF;
  UPDATE wallets SET balance = v_current + p_amount, updated_at = NOW()
    WHERE user_id = p_parent_id;
  INSERT INTO payments (parent_id, type, amount_total, method, status,
    reference_id, external_ref, paymongo_refund_id, paymongo_payment_id,
    paymongo_checkout_id, original_payment_id)
  VALUES (p_parent_id, p_type, p_amount, p_method, 'completed',
    p_reference_id, p_external_ref, p_paymongo_refund_id, p_paymongo_payment_id,
    p_paymongo_checkout_id, p_original_payment_id)
  RETURNING id INTO v_payment_id;
  IF p_order_id IS NOT NULL THEN
    INSERT INTO payment_allocations (payment_id, order_id, allocated_amount)
      VALUES (v_payment_id, p_order_id, p_amount);
  END IF;
  RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql;

-- Legacy table lockdown
CREATE OR REPLACE FUNCTION block_legacy_writes()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'transactions_legacy is read-only. Use payments + payment_allocations.';
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TABLES
-- ============================================

-- User profiles (all user types: parent, staff, admin)
-- Originally "parents", renamed in migration 20260112
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

-- Wallets (balance for parent users)
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  balance NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
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

-- Parent ↔ Student linking (many-to-many)
CREATE TABLE IF NOT EXISTS parent_students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relationship TEXT DEFAULT 'parent',
  is_primary BOOLEAN DEFAULT TRUE,
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(parent_id, student_id)
);

-- Products (menu items)
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  category TEXT NOT NULL,
  image_url TEXT,
  available BOOLEAN DEFAULT TRUE,
  stock_quantity INTEGER DEFAULT 0 CHECK (stock_quantity >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  student_id UUID REFERENCES students(id) ON DELETE RESTRICT,
  client_order_id UUID UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('awaiting_payment', 'pending', 'preparing', 'ready', 'completed', 'cancelled')),
  total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('cash', 'balance', 'gcash', 'paymaya', 'card', 'paymongo')),
  payment_status payment_status DEFAULT 'paid',
  payment_due_at TIMESTAMPTZ,
  paymongo_checkout_id TEXT,
  paymongo_payment_id TEXT,
  payment_group_id UUID,
  notes TEXT,
  scheduled_for DATE DEFAULT CURRENT_DATE,
  meal_period TEXT NOT NULL DEFAULT 'lunch'
    CHECK (meal_period IN ('morning_snack', 'lunch', 'afternoon_snack')),
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

-- Payments (one row per real money movement)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('payment', 'refund', 'topup')),
  amount_total NUMERIC(10,2) NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash', 'gcash', 'paymaya', 'card', 'paymongo', 'balance')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed')),
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

-- Top-up sessions (self-service wallet top-ups via PayMongo)
CREATE TABLE IF NOT EXISTS topup_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 50 AND amount <= 50000),
  paymongo_checkout_id TEXT NOT NULL,
  paymongo_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'expired', 'failed')),
  payment_method TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
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

-- Menu schedules (weekly day-of-week pattern + optional date-specific overrides)
CREATE TABLE IF NOT EXISTS menu_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 1 AND day_of_week <= 5),
  scheduled_date DATE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

-- Default system settings
INSERT INTO system_settings (key, value, description) VALUES
  ('canteen_name', '"LOHECA Canteen"', 'Name of the canteen displayed in the app'),
  ('operating_hours', '{"open": "07:00", "close": "15:00"}', 'Operating hours for the canteen'),
  ('order_cutoff_time', '"10:00"', 'Daily cutoff time for placing orders'),
  ('allow_future_orders', 'true', 'Allow parents to order for future dates'),
  ('max_future_days', '5', 'Maximum days ahead for future orders'),
  ('low_stock_threshold', '10', 'Threshold for low stock warnings'),
  ('auto_complete_orders', 'false', 'Automatically complete orders after pickup'),
  ('notification_email', 'null', 'Email for admin notifications'),
  ('maintenance_mode', 'false', 'Put the app in maintenance mode')
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
    CHECK (payment_method IN ('cash', 'gcash', 'balance')),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Favorites (user ↔ product)
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

-- wallets
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);

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
CREATE INDEX IF NOT EXISTS idx_products_stock_quantity
  ON products(stock_quantity) WHERE available = true AND stock_quantity <= 10;

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

-- Unique partial index: prevent duplicate active orders per student+date
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_order_per_student_date
  ON orders(student_id, scheduled_for)
  WHERE status NOT IN ('cancelled');

-- Composite lookup index for fast slot queries
CREATE INDEX IF NOT EXISTS idx_orders_student_date
  ON orders(student_id, scheduled_for);

-- DEPRECATED: orders.meal_period — use order_items.meal_period instead

-- order_items
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

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
CREATE INDEX IF NOT EXISTS idx_orders_paymongo_payment_id
  ON orders(paymongo_payment_id) WHERE paymongo_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_payment_group
  ON orders(payment_group_id) WHERE payment_group_id IS NOT NULL;

-- topup_sessions
CREATE INDEX IF NOT EXISTS idx_topup_sessions_parent_id ON topup_sessions(parent_id);
CREATE INDEX IF NOT EXISTS idx_topup_sessions_checkout_id ON topup_sessions(paymongo_checkout_id);
CREATE INDEX IF NOT EXISTS idx_topup_sessions_status ON topup_sessions(status) WHERE status = 'pending';

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

-- Check if menu is available for a given date
CREATE OR REPLACE FUNCTION is_menu_available(check_date DATE)
RETURNS BOOLEAN AS $$
DECLARE
  day_num INTEGER;
  is_hol BOOLEAN;
BEGIN
  day_num := EXTRACT(DOW FROM check_date);
  IF day_num = 0 OR day_num = 6 THEN
    RETURN FALSE;
  END IF;
  SELECT EXISTS(SELECT 1 FROM holidays WHERE date = check_date) INTO is_hol;
  IF is_hol THEN
    RETURN FALSE;
  END IF;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get today's menu (respects holidays)
CREATE OR REPLACE FUNCTION get_todays_menu()
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  price NUMERIC(10,2),
  category TEXT,
  image_url TEXT,
  available BOOLEAN,
  stock_quantity INTEGER
) AS $$
DECLARE
  today_dow INTEGER;
BEGIN
  IF NOT is_canteen_open(CURRENT_DATE) THEN
    RETURN;
  END IF;

  today_dow := EXTRACT(DOW FROM CURRENT_DATE)::INTEGER;

  RETURN QUERY
  SELECT
    p.id, p.name, p.description, p.price,
    p.category, p.image_url, p.available, p.stock_quantity
  FROM products p
  INNER JOIN menu_schedules ms ON p.id = ms.product_id
  WHERE ms.day_of_week = today_dow
    AND ms.is_active = TRUE
    AND p.available = TRUE
  ORDER BY p.category, p.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get menu for a specific day of week (1=Mon … 5=Fri)
CREATE OR REPLACE FUNCTION get_menu_for_day(target_day INTEGER)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  price NUMERIC(10,2),
  category TEXT,
  image_url TEXT,
  available BOOLEAN,
  stock_quantity INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id, p.name, p.description, p.price,
    p.category, p.image_url, p.available, p.stock_quantity
  FROM products p
  INNER JOIN menu_schedules ms ON p.id = ms.product_id
  WHERE ms.day_of_week = target_day
    AND ms.is_active = TRUE
  ORDER BY p.category, p.name;
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
  product_available BOOLEAN,
  product_stock_quantity INTEGER
) AS $$
DECLARE
  day_num INTEGER;
BEGIN
  day_num := EXTRACT(DOW FROM target_date);

  -- Weekend → nothing
  IF day_num = 0 OR day_num = 6 THEN
    RETURN;
  END IF;

  -- Holiday → nothing
  IF EXISTS(SELECT 1 FROM holidays WHERE date = target_date) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.name, p.description, p.price,
    p.category, p.image_url, p.available, p.stock_quantity
  FROM products p
  INNER JOIN menu_schedules ms ON p.id = ms.product_id
  WHERE ms.day_of_week = day_num
    AND ms.is_active = true
    AND p.available = true
  ORDER BY p.category, p.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Sync user role from auth.users app_metadata → user_profiles.role
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
  balance_revenue NUMERIC,
  gcash_revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE(o.created_at) as sale_date,
    COALESCE(SUM(o.total_amount), 0) as total_revenue,
    COUNT(*) as order_count,
    COALESCE(AVG(o.total_amount), 0) as avg_order_value,
    COALESCE(SUM(CASE WHEN o.payment_method = 'cash'    THEN o.total_amount ELSE 0 END), 0) as cash_revenue,
    COALESCE(SUM(CASE WHEN o.payment_method = 'balance' THEN o.total_amount ELSE 0 END), 0) as balance_revenue,
    COALESCE(SUM(CASE WHEN o.payment_method = 'gcash'   THEN o.total_amount ELSE 0 END), 0) as gcash_revenue
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

-- Basic dashboard stats (backward-compat)
DROP FUNCTION IF EXISTS get_dashboard_stats();
CREATE OR REPLACE FUNCTION get_dashboard_stats()
RETURNS TABLE (
  total_orders BIGINT,
  total_revenue NUMERIC,
  total_products BIGINT,
  total_parents BIGINT,
  pending_orders BIGINT,
  completed_today BIGINT,
  revenue_today NUMERIC,
  revenue_this_week NUMERIC,
  revenue_this_month NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM orders)::BIGINT,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE status = 'completed')::NUMERIC,
    (SELECT COUNT(*) FROM products WHERE available = true)::BIGINT,
    (SELECT COUNT(*) FROM user_profiles WHERE
      id IN (SELECT DISTINCT user_id FROM wallets) OR
      id IN (SELECT DISTINCT parent_id FROM parent_students)
    )::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE status = 'pending')::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE status = 'completed' AND DATE(created_at) = CURRENT_DATE)::BIGINT,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE status = 'completed' AND DATE(created_at) = CURRENT_DATE)::NUMERIC,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE status = 'completed' AND created_at >= date_trunc('week', CURRENT_DATE))::NUMERIC,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE status = 'completed' AND created_at >= date_trunc('month', CURRENT_DATE))::NUMERIC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Optimised admin dashboard stats (uses scheduled_for)
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
  low_stock_products BIGINT,
  out_of_stock_products BIGINT,
  yesterday_orders BIGINT,
  yesterday_revenue NUMERIC,
  week_orders BIGINT,
  week_revenue NUMERIC,
  month_orders BIGINT,
  month_revenue NUMERIC,
  future_orders BIGINT,
  active_parents_today BIGINT
) AS $$
DECLARE
  yesterday_date DATE := target_date - INTERVAL '1 day';
  week_start DATE := date_trunc('week', target_date)::DATE;
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
    (SELECT COUNT(*) FROM products WHERE stock_quantity <= 10 AND stock_quantity > 0 AND available = true)::BIGINT,
    (SELECT COUNT(*) FROM products WHERE stock_quantity = 0 OR available = false)::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for = yesterday_date)::BIGINT,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE scheduled_for = yesterday_date AND status != 'cancelled')::NUMERIC,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for >= week_start AND scheduled_for <= target_date)::BIGINT,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE scheduled_for >= week_start AND scheduled_for <= target_date AND status != 'cancelled')::NUMERIC,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for >= month_start AND scheduled_for <= target_date)::BIGINT,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE scheduled_for >= month_start AND scheduled_for <= target_date AND status != 'cancelled')::NUMERIC,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for > target_date AND status != 'cancelled')::BIGINT,
    (SELECT COUNT(DISTINCT parent_id) FROM orders WHERE scheduled_for = target_date)::BIGINT;
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

-- Cart-item date validation (no past dates, no Sundays, Saturdays only if makeup day, no holidays)
CREATE OR REPLACE FUNCTION validate_cart_item_date()
RETURNS TRIGGER AS $$
DECLARE
  day_of_week INTEGER;
  is_holiday BOOLEAN;
  is_makeup_day BOOLEAN;
  today_ph DATE;
BEGIN
  today_ph := (NOW() AT TIME ZONE 'Asia/Manila')::DATE;

  IF NEW.scheduled_for < today_ph THEN
    RAISE EXCEPTION 'Cannot add items for past dates. Selected: %, Today: %', NEW.scheduled_for, today_ph;
  END IF;

  day_of_week := EXTRACT(DOW FROM NEW.scheduled_for);

  IF day_of_week = 0 THEN
    RAISE EXCEPTION 'Cannot add items for Sundays. The canteen is closed.';
  END IF;

  IF day_of_week = 6 THEN
    SELECT EXISTS(
      SELECT 1 FROM makeup_days WHERE date = NEW.scheduled_for
    ) INTO is_makeup_day;
    IF NOT is_makeup_day THEN
      RAISE EXCEPTION 'Cannot add items for Saturdays unless it is a make-up class day.';
    END IF;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM holidays
    WHERE (date = NEW.scheduled_for)
       OR (is_recurring = true AND
           EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM NEW.scheduled_for) AND
           EXTRACT(DAY FROM date)   = EXTRACT(DAY FROM NEW.scheduled_for))
  ) INTO is_holiday;

  IF is_holiday THEN
    RAISE EXCEPTION 'Cannot add items for holidays. The canteen is closed on this date.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

-- Cart max-advance validation (14 days)
CREATE OR REPLACE FUNCTION validate_cart_item_max_advance()
RETURNS TRIGGER AS $$
DECLARE
  today_ph DATE;
  max_advance_days INTEGER := 14;
BEGIN
  today_ph := (NOW() AT TIME ZONE 'Asia/Manila')::DATE;
  IF NEW.scheduled_for > today_ph + max_advance_days THEN
    RAISE EXCEPTION 'Cannot add items more than % days in advance.', max_advance_days;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Atomic stock increment (for order cancellation / refund)
CREATE OR REPLACE FUNCTION increment_stock(p_product_id UUID, p_quantity INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE products
  SET stock_quantity = stock_quantity + p_quantity
  WHERE id = p_product_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomic stock decrement with row lock (for order creation)
CREATE OR REPLACE FUNCTION decrement_stock(p_product_id UUID, p_quantity INTEGER)
RETURNS VOID AS $$
DECLARE
  current_stock INTEGER;
BEGIN
  SELECT stock_quantity INTO current_stock
  FROM products
  WHERE id = p_product_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;
  
  IF current_stock < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock for product %. Available: %, Requested: %',
      p_product_id, current_stock, p_quantity;
  END IF;
  
  UPDATE products
  SET stock_quantity = stock_quantity - p_quantity
  WHERE id = p_product_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION increment_stock(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION decrement_stock(UUID, INTEGER) TO authenticated;

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

DROP TRIGGER IF EXISTS update_wallets_updated_at ON wallets;
CREATE TRIGGER update_wallets_updated_at
  BEFORE UPDATE ON wallets
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

DROP TRIGGER IF EXISTS update_menu_schedules_timestamp ON menu_schedules;
CREATE TRIGGER update_menu_schedules_timestamp
  BEFORE UPDATE ON menu_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_cart_items_updated_at ON cart_items;
CREATE TRIGGER update_cart_items_updated_at
  BEFORE UPDATE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Sync role from auth.users app_metadata → user_profiles on UPDATE only
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

-- Cart validation triggers
DROP TRIGGER IF EXISTS validate_cart_item_date_trigger ON cart_items;
CREATE TRIGGER validate_cart_item_date_trigger
  BEFORE INSERT OR UPDATE OF scheduled_for ON cart_items
  FOR EACH ROW
  EXECUTE FUNCTION validate_cart_item_date();

DROP TRIGGER IF EXISTS validate_cart_item_max_advance_trigger ON cart_items;
CREATE TRIGGER validate_cart_item_max_advance_trigger
  BEFORE INSERT OR UPDATE OF scheduled_for ON cart_items
  FOR EACH ROW
  EXECUTE FUNCTION validate_cart_item_max_advance();

-- ── Financial hardening triggers ──

-- Allocation integrity
DROP TRIGGER IF EXISTS trg_check_allocation_integrity ON payment_allocations;
CREATE CONSTRAINT TRIGGER trg_check_allocation_integrity
  AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_allocation_integrity();

-- Amount immutability
DROP TRIGGER IF EXISTS trg_prevent_amount_mutation ON payments;
CREATE TRIGGER trg_prevent_amount_mutation
  BEFORE UPDATE ON payments FOR EACH ROW
  EXECUTE FUNCTION prevent_amount_mutation();

DROP TRIGGER IF EXISTS trg_prevent_allocation_amount_mutation ON payment_allocations;
CREATE TRIGGER trg_prevent_allocation_amount_mutation
  BEFORE UPDATE ON payment_allocations FOR EACH ROW
  EXECUTE FUNCTION prevent_allocation_amount_mutation();

-- Payment status transition guard
DROP TRIGGER IF EXISTS trg_guard_payment_status ON payments;
CREATE TRIGGER trg_guard_payment_status
  BEFORE UPDATE OF status ON payments FOR EACH ROW
  EXECUTE FUNCTION guard_payment_status_transition();

-- Legacy table lockdown
DROP TRIGGER IF EXISTS trg_block_legacy_writes ON transactions_legacy;
CREATE TRIGGER trg_block_legacy_writes
  BEFORE INSERT OR UPDATE OR DELETE ON transactions_legacy
  FOR EACH ROW EXECUTE FUNCTION block_legacy_writes();

-- ============================================
-- ENABLE ROW LEVEL SECURITY ON ALL TABLES
-- ============================================

ALTER TABLE user_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE students         ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_students  ENABLE ROW LEVEL SECURITY;
ALTER TABLE products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items      ENABLE ROW LEVEL SECURITY;
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
ALTER TABLE topup_sessions   ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES
-- All role checks use app_metadata (server-only, not client-writable).
-- ============================================

-- ─── user_profiles ───────────────────────────

DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile on signup" ON user_profiles;
CREATE POLICY "Users can insert own profile on signup"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Staff can view all user profiles" ON user_profiles;
CREATE POLICY "Staff can view all user profiles"
  ON user_profiles FOR SELECT
  USING (is_staff_or_admin());

DROP POLICY IF EXISTS "Admin can update any user profile" ON user_profiles;
CREATE POLICY "Admin can update any user profile"
  ON user_profiles FOR UPDATE
  USING (is_admin());

-- ─── wallets ─────────────────────────────────

DROP POLICY IF EXISTS "Users can view own wallet" ON wallets;
CREATE POLICY "Users can view own wallet"
  ON wallets FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own wallet" ON wallets;
CREATE POLICY "Users can update own wallet"
  ON wallets FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own wallet" ON wallets;
CREATE POLICY "Users can insert own wallet"
  ON wallets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Staff can view all wallets" ON wallets;
CREATE POLICY "Staff can view all wallets"
  ON wallets FOR SELECT
  USING (is_staff_or_admin());

DROP POLICY IF EXISTS "Admin can update any wallet" ON wallets;
CREATE POLICY "Admin can update any wallet"
  ON wallets FOR UPDATE
  USING (is_admin());

-- ─── students ────────────────────────────────

DROP POLICY IF EXISTS "Admins can manage all students" ON students;
CREATE POLICY "Admins can manage all students"
  ON students FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "Staff can view all students" ON students;
CREATE POLICY "Staff can view all students"
  ON students FOR SELECT
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('staff', 'admin'));

DROP POLICY IF EXISTS "Parents can view their linked students" ON students;
CREATE POLICY "Parents can view their linked students"
  ON students FOR SELECT
  USING (id IN (SELECT student_id FROM parent_students WHERE parent_id = auth.uid()));

-- ─── parent_students ─────────────────────────

DROP POLICY IF EXISTS "Parents can view their own links" ON parent_students;
CREATE POLICY "Parents can view their own links"
  ON parent_students FOR SELECT
  USING (parent_id = auth.uid());

DROP POLICY IF EXISTS "Parents can link unlinked students" ON parent_students;
CREATE POLICY "Parents can link unlinked students"
  ON parent_students FOR INSERT
  WITH CHECK (
    parent_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM parent_students ps2
      WHERE ps2.student_id = parent_students.student_id
    )
  );

DROP POLICY IF EXISTS "Admins can manage all links" ON parent_students;
CREATE POLICY "Admins can manage all links"
  ON parent_students FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "Staff can view all links" ON parent_students;
CREATE POLICY "Staff can view all links"
  ON parent_students FOR SELECT
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('staff', 'admin'));

-- ─── products ────────────────────────────────

DROP POLICY IF EXISTS "Anyone can view available products" ON products;
CREATE POLICY "Anyone can view available products"
  ON products FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS "Staff can insert products" ON products;
CREATE POLICY "Staff can insert products"
  ON products FOR INSERT
  WITH CHECK (is_staff_or_admin());

DROP POLICY IF EXISTS "Staff can update products" ON products;
CREATE POLICY "Staff can update products"
  ON products FOR UPDATE
  USING (is_staff_or_admin());

DROP POLICY IF EXISTS "Admin can delete products" ON products;
CREATE POLICY "Admin can delete products"
  ON products FOR DELETE
  USING (is_admin());

-- ─── orders ──────────────────────────────────

DROP POLICY IF EXISTS "Parents can view own orders" ON orders;
DROP POLICY IF EXISTS "Parents can view their orders" ON orders;
CREATE POLICY "Parents can view their orders"
  ON orders FOR SELECT
  USING (parent_id = auth.uid());

DROP POLICY IF EXISTS "Parents can create orders" ON orders;
CREATE POLICY "Parents can create orders"
  ON orders FOR INSERT
  WITH CHECK (
    parent_id = auth.uid()
    AND student_id IN (
      SELECT ps.student_id FROM parent_students ps WHERE ps.parent_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Staff can view all orders" ON orders;
CREATE POLICY "Staff can view all orders"
  ON orders FOR SELECT
  USING (is_staff_or_admin());

DROP POLICY IF EXISTS "Staff can update order status" ON orders;
CREATE POLICY "Staff can update order status"
  ON orders FOR UPDATE
  USING (is_staff_or_admin());

-- ─── order_items ─────────────────────────────

DROP POLICY IF EXISTS "Parents can view own order items" ON order_items;
CREATE POLICY "Parents can view own order items"
  ON order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_items.order_id
        AND orders.parent_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Staff can view all order items" ON order_items;
CREATE POLICY "Staff can view all order items"
  ON order_items FOR SELECT
  USING (is_staff_or_admin());

-- ─── payments ────────────────────────────

DROP POLICY IF EXISTS "Parents can view own payments" ON payments;
CREATE POLICY "Parents can view own payments"
  ON payments FOR SELECT
  USING (parent_id = auth.uid());

DROP POLICY IF EXISTS "Staff can view all payments" ON payments;
CREATE POLICY "Staff can view all payments"
  ON payments FOR SELECT
  USING (is_staff_or_admin());

DROP POLICY IF EXISTS "Admin can insert payments" ON payments;
CREATE POLICY "Admin can insert payments"
  ON payments FOR INSERT
  WITH CHECK (is_admin());

-- ─── payment_allocations ─────────────────

DROP POLICY IF EXISTS "Parents can view own allocations" ON payment_allocations;
CREATE POLICY "Parents can view own allocations"
  ON payment_allocations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM payments p WHERE p.id = payment_id AND p.parent_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Staff can view all allocations" ON payment_allocations;
CREATE POLICY "Staff can view all allocations"
  ON payment_allocations FOR SELECT
  USING (is_staff_or_admin());

-- ─── topup_sessions ─────────────────────────

DROP POLICY IF EXISTS "Parents can view own topup sessions" ON topup_sessions;
CREATE POLICY "Parents can view own topup sessions"
  ON topup_sessions FOR SELECT
  USING (parent_id = auth.uid());

-- Edge functions use service_role key which bypasses RLS for insert/update

-- ─── invitations ─────────────────────────────

DROP POLICY IF EXISTS "Admins can manage invitations" ON invitations;
CREATE POLICY "Admins can manage invitations"
  ON invitations FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "Anyone can read invitation by code" ON invitations;
DROP POLICY IF EXISTS "Admin can read invitations" ON invitations;
CREATE POLICY "Admin can read invitations"
  ON invitations FOR SELECT
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- ─── menu_schedules ─────────────────────────

DROP POLICY IF EXISTS "Anyone can view menu schedules" ON menu_schedules;
DROP POLICY IF EXISTS "Admin can insert menu schedules" ON menu_schedules;
DROP POLICY IF EXISTS "Admin can update menu schedules" ON menu_schedules;
DROP POLICY IF EXISTS "Admin can delete menu schedules" ON menu_schedules;
DROP POLICY IF EXISTS "Admin can manage menu schedules" ON menu_schedules;

CREATE POLICY "Anyone can view menu schedules"
  ON menu_schedules FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "Admin can manage menu schedules"
  ON menu_schedules FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ─── holidays ────────────────────────────────

DROP POLICY IF EXISTS "Anyone can view holidays" ON holidays;
DROP POLICY IF EXISTS "Admin can insert holidays" ON holidays;
DROP POLICY IF EXISTS "Admin can update holidays" ON holidays;
DROP POLICY IF EXISTS "Admin can delete holidays" ON holidays;

CREATE POLICY "Anyone can view holidays"
  ON holidays FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "Admin can insert holidays"
  ON holidays FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "Admin can update holidays"
  ON holidays FOR UPDATE
  TO authenticated
  USING  ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "Admin can delete holidays"
  ON holidays FOR DELETE
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ─── makeup_days ─────────────────────────────

DROP POLICY IF EXISTS "Anyone can view makeup days" ON makeup_days;
DROP POLICY IF EXISTS "Admins can insert makeup days" ON makeup_days;
DROP POLICY IF EXISTS "Admins can update makeup days" ON makeup_days;
DROP POLICY IF EXISTS "Admins can delete makeup days" ON makeup_days;

CREATE POLICY "Anyone can view makeup days"
  ON makeup_days FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert makeup days"
  ON makeup_days FOR INSERT
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "Admins can update makeup days"
  ON makeup_days FOR UPDATE
  USING  ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "Admins can delete makeup days"
  ON makeup_days FOR DELETE
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ─── menu_date_overrides ─────────────────────

DROP POLICY IF EXISTS "Anyone can view menu date overrides" ON menu_date_overrides;
DROP POLICY IF EXISTS "Admin can manage menu date overrides" ON menu_date_overrides;

CREATE POLICY "Anyone can view menu date overrides"
  ON menu_date_overrides FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "Admin can manage menu date overrides"
  ON menu_date_overrides FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ─── date_closures ───────────────────────────

DROP POLICY IF EXISTS "Anyone can view date closures" ON date_closures;
DROP POLICY IF EXISTS "Admin can manage date closures" ON date_closures;

CREATE POLICY "Anyone can view date closures"
  ON date_closures FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "Admin can manage date closures"
  ON date_closures FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ─── system_settings ─────────────────────────

DROP POLICY IF EXISTS "Anyone can view settings" ON system_settings;
CREATE POLICY "Anyone can view settings"
  ON system_settings FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS "Admins can update settings" ON system_settings;
CREATE POLICY "Admins can update settings"
  ON system_settings FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admins can insert settings" ON system_settings;
CREATE POLICY "Admins can insert settings"
  ON system_settings FOR INSERT
  WITH CHECK (is_admin());

-- ─── audit_logs ──────────────────────────────

DROP POLICY IF EXISTS "Admins can view audit logs" ON audit_logs;
CREATE POLICY "Admins can view audit logs"
  ON audit_logs FOR SELECT
  USING (is_admin());

DROP POLICY IF EXISTS "System can insert audit logs" ON audit_logs;
DROP POLICY IF EXISTS "Staff and admin can insert audit logs" ON audit_logs;
CREATE POLICY "Staff and admin can insert audit logs"
  ON audit_logs FOR INSERT
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff')
  );

-- ─── cart_items ──────────────────────────────

DROP POLICY IF EXISTS "Users can view own cart items" ON cart_items;
CREATE POLICY "Users can view own cart items"
  ON cart_items FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own cart items" ON cart_items;
CREATE POLICY "Users can insert own cart items"
  ON cart_items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own cart items" ON cart_items;
CREATE POLICY "Users can update own cart items"
  ON cart_items FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own cart items" ON cart_items;
CREATE POLICY "Users can delete own cart items"
  ON cart_items FOR DELETE
  USING (auth.uid() = user_id);

-- ─── cart_state ──────────────────────────────

DROP POLICY IF EXISTS "Users can view own cart state" ON cart_state;
CREATE POLICY "Users can view own cart state"
  ON cart_state FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own cart state" ON cart_state;
CREATE POLICY "Users can insert own cart state"
  ON cart_state FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own cart state" ON cart_state;
CREATE POLICY "Users can update own cart state"
  ON cart_state FOR UPDATE
  USING (auth.uid() = user_id);

-- ─── favorites ───────────────────────────────

DROP POLICY IF EXISTS "Users can view own favorites" ON favorites;
CREATE POLICY "Users can view own favorites"
  ON favorites FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own favorites" ON favorites;
CREATE POLICY "Users can insert own favorites"
  ON favorites FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own favorites" ON favorites;
CREATE POLICY "Users can delete own favorites"
  ON favorites FOR DELETE
  USING (auth.uid() = user_id);

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

COMMENT ON COLUMN orders.scheduled_for   IS 'The date when the order should be fulfilled. Defaults to current date for immediate orders.';
COMMENT ON COLUMN orders.status          IS 'awaiting_payment=cash order waiting for payment, pending=ready for kitchen, preparing=being made, ready=pickup, completed=done, cancelled=cancelled';
COMMENT ON COLUMN orders.payment_status  IS 'awaiting_payment=cash not yet received, paid=payment confirmed, timeout=auto-cancelled due to no payment, refunded=money returned';
COMMENT ON COLUMN orders.payment_due_at  IS 'Deadline for cash payment. After this time, order can be auto-cancelled.';
COMMENT ON COLUMN cart_items.scheduled_for IS 'The date when the order is intended for. Must be a valid school day (Mon-Fri or makeup Saturday), not a holiday, not in the past, and within 14 days.';
COMMENT ON COLUMN holidays.is_recurring  IS 'If true, the holiday recurs every year on the same date';
COMMENT ON TABLE  makeup_days            IS 'Stores Saturday make-up class days when canteen should be open';
COMMENT ON FUNCTION get_admin_dashboard_stats IS 'Optimized function for admin dashboard stats with proper scheduled_for filtering';

-- ============================================
-- END OF CONSOLIDATED SCHEMA
-- ============================================
