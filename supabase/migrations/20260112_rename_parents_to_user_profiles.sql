-- Migration: Rename parents to user_profiles and move balance to wallets table
-- This improves the schema since user_profiles stores all user types, not just parents

-- ============================================
-- STEP 1: Create wallets table (before renaming parents)
-- ============================================

CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  balance NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migrate existing balance data
INSERT INTO wallets (user_id, balance, created_at, updated_at)
SELECT id, COALESCE(balance, 0.00), created_at, updated_at
FROM parents
WHERE (auth.jwt() -> 'user_metadata' ->> 'role') IS NULL 
   OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'parent';

-- Actually, we can't use auth.jwt() in a migration, so just migrate all:
TRUNCATE wallets;
INSERT INTO wallets (user_id, balance, created_at, updated_at)
SELECT id, COALESCE(balance, 0.00), created_at, updated_at
FROM parents;

-- Create index
CREATE INDEX idx_wallets_user_id ON wallets(user_id);

-- Enable RLS
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;

-- Wallets RLS policies
CREATE POLICY "Users can view own wallet"
  ON wallets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own wallet"
  ON wallets FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert own wallet"
  ON wallets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Staff can view all wallets"
  ON wallets FOR SELECT
  USING (is_staff_or_admin());

CREATE POLICY "Admin can update any wallet"
  ON wallets FOR UPDATE
  USING (is_admin());

-- Trigger for updated_at
CREATE TRIGGER update_wallets_updated_at
  BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- STEP 2: Rename parents table to user_profiles
-- ============================================

-- Drop old policies first
DROP POLICY IF EXISTS "Parents can view own profile" ON parents;
DROP POLICY IF EXISTS "Parents can update own profile" ON parents;
DROP POLICY IF EXISTS "Parents can insert own profile on signup" ON parents;
DROP POLICY IF EXISTS "Staff can view all parents" ON parents;
DROP POLICY IF EXISTS "Admin can update any parent" ON parents;

-- Drop old trigger
DROP TRIGGER IF EXISTS update_parents_updated_at ON parents;

-- Rename the table
ALTER TABLE parents RENAME TO user_profiles;

-- Drop the balance column (now in wallets table)
ALTER TABLE user_profiles DROP COLUMN IF EXISTS balance;

-- Rename indexes
ALTER INDEX IF EXISTS idx_parents_email RENAME TO idx_user_profiles_email;

-- Recreate trigger with new table name
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create new RLS policies for user_profiles
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile on signup"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Staff can view all user profiles"
  ON user_profiles FOR SELECT
  USING (is_staff_or_admin());

CREATE POLICY "Admin can update any user profile"
  ON user_profiles FOR UPDATE
  USING (is_admin());

-- ============================================
-- STEP 3: Update FK reference in wallets (now references user_profiles)
-- The FK is automatically updated when we renamed the table
-- ============================================

-- ============================================
-- STEP 4: Update dashboard stats function
-- ============================================

-- Drop existing function first to avoid return type conflict
DROP FUNCTION IF EXISTS get_dashboard_stats();

-- Update the get_dashboard_stats function to use new table name
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
      id IN (SELECT DISTINCT parent_id FROM children WHERE parent_id IS NOT NULL)
    )::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE status = 'pending')::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE status = 'completed' AND DATE(created_at) = CURRENT_DATE)::BIGINT,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE status = 'completed' AND DATE(created_at) = CURRENT_DATE)::NUMERIC,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE status = 'completed' AND created_at >= date_trunc('week', CURRENT_DATE))::NUMERIC,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE status = 'completed' AND created_at >= date_trunc('month', CURRENT_DATE))::NUMERIC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- STEP 5: Create view for backward compatibility (optional, for debugging)
-- ============================================

CREATE OR REPLACE VIEW parents AS
SELECT 
  up.id,
  up.email,
  up.phone_number,
  up.first_name,
  up.last_name,
  COALESCE(w.balance, 0.00) as balance,
  up.created_at,
  up.updated_at
FROM user_profiles up
LEFT JOIN wallets w ON w.user_id = up.id;

-- Note: This view is for backward compatibility during transition
-- New code should use user_profiles and wallets directly

COMMENT ON VIEW parents IS 'DEPRECATED: Use user_profiles and wallets tables directly. This view exists for backward compatibility.';
