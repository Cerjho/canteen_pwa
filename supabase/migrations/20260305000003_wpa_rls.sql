-- =============================================================================
-- Migration 3: Weekly Pre-Order Architecture — RLS Policies
-- =============================================================================
-- Enable Row-Level Security on new tables and create granular policies.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. weekly_orders policies
-- ---------------------------------------------------------------------------

ALTER TABLE weekly_orders ENABLE ROW LEVEL SECURITY;

-- Parents see own orders
CREATE POLICY "Parents view own weekly orders"
  ON weekly_orders FOR SELECT
  USING (parent_id = auth.uid());

-- Parents insert own orders
CREATE POLICY "Parents create own weekly orders"
  ON weekly_orders FOR INSERT
  WITH CHECK (parent_id = auth.uid());

-- Parents update own orders (status must be pending/confirmed)
CREATE POLICY "Parents update own weekly orders"
  ON weekly_orders FOR UPDATE
  USING (
    parent_id = auth.uid()
    AND status IN ('pending', 'confirmed')
  )
  WITH CHECK (parent_id = auth.uid());

-- Staff/Admin read all
CREATE POLICY "Staff read all weekly orders"
  ON weekly_orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
  );

-- Staff/Admin update all
CREATE POLICY "Staff update all weekly orders"
  ON weekly_orders FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
  );

-- ---------------------------------------------------------------------------
-- 2. surplus_items policies
-- ---------------------------------------------------------------------------

ALTER TABLE surplus_items ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can view surplus items
CREATE POLICY "Authenticated users view surplus items"
  ON surplus_items FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Only staff/admin can insert surplus items
CREATE POLICY "Staff insert surplus items"
  ON surplus_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
  );

-- Only staff/admin can update surplus items
CREATE POLICY "Staff update surplus items"
  ON surplus_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
  );

-- Only admin can delete surplus items
CREATE POLICY "Admin delete surplus items"
  ON surplus_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
