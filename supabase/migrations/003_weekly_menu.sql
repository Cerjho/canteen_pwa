-- Weekly Menu Schedule migration
-- Allows admin to set different menu items for each day of the week

-- ============================================
-- TABLES
-- ============================================

-- Menu schedules table (which products are available on which days)
CREATE TABLE menu_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  -- 0 = Sunday, 1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday, 5 = Friday, 6 = Saturday
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Each product can only be scheduled once per day
  UNIQUE(product_id, day_of_week)
);

-- Index for faster day lookups
CREATE INDEX idx_menu_schedules_day ON menu_schedules(day_of_week);
CREATE INDEX idx_menu_schedules_product ON menu_schedules(product_id);
CREATE INDEX idx_menu_schedules_active ON menu_schedules(is_active) WHERE is_active = TRUE;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE menu_schedules ENABLE ROW LEVEL SECURITY;

-- Everyone can read menu schedules
CREATE POLICY "Anyone can view menu schedules"
  ON menu_schedules FOR SELECT
  TO authenticated, anon
  USING (true);

-- Only admin can manage menu schedules
CREATE POLICY "Admin can manage menu schedules"
  ON menu_schedules FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_user_meta_data->>'role')::text = 'admin'
    )
  );

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to get today's menu products
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
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.name,
    p.description,
    p.price,
    p.category,
    p.image_url,
    p.available,
    p.stock_quantity
  FROM products p
  INNER JOIN menu_schedules ms ON p.id = ms.product_id
  WHERE ms.day_of_week = EXTRACT(DOW FROM CURRENT_DATE)::INTEGER
    AND ms.is_active = TRUE
    AND p.available = TRUE
  ORDER BY p.category, p.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get menu for a specific day
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
    p.id,
    p.name,
    p.description,
    p.price,
    p.category,
    p.image_url,
    p.available,
    p.stock_quantity
  FROM products p
  INNER JOIN menu_schedules ms ON p.id = ms.product_id
  WHERE ms.day_of_week = target_day
    AND ms.is_active = TRUE
  ORDER BY p.category, p.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- TRIGGERS
-- ============================================

-- Update timestamp trigger
CREATE TRIGGER update_menu_schedules_timestamp
  BEFORE UPDATE ON menu_schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
