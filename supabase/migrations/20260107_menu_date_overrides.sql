-- Add support for date-specific menu overrides
-- This allows overriding the weekly template for specific dates

-- ============================================
-- MENU DATE OVERRIDES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS menu_date_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Each product can only be scheduled once per date
  UNIQUE(product_id, scheduled_date)
);

-- Index for faster date lookups
CREATE INDEX idx_menu_date_overrides_date ON menu_date_overrides(scheduled_date);
CREATE INDEX idx_menu_date_overrides_active ON menu_date_overrides(is_active) WHERE is_active = TRUE;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE menu_date_overrides ENABLE ROW LEVEL SECURITY;

-- Everyone can read menu date overrides
CREATE POLICY "Anyone can view menu date overrides"
  ON menu_date_overrides FOR SELECT
  TO authenticated, anon
  USING (true);

-- Only admin can manage menu date overrides
CREATE POLICY "Admin can manage menu date overrides"
  ON menu_date_overrides FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_user_meta_data->>'role')::text = 'admin'
    )
  );

-- ============================================
-- DATE CLOSURES TABLE (close canteen on specific dates without holidays)
-- ============================================

CREATE TABLE IF NOT EXISTS date_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  closure_date DATE NOT NULL UNIQUE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

ALTER TABLE date_closures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view date closures"
  ON date_closures FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "Admin can manage date closures"
  ON date_closures FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_user_meta_data->>'role')::text = 'admin'
    )
  );

