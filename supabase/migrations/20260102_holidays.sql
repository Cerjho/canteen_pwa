-- Add holidays table and update menu scheduling for weekdays only

-- ============================================
-- HOLIDAYS TABLE
-- ============================================

CREATE TABLE holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  date DATE NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Index for date lookups
CREATE INDEX idx_holidays_date ON holidays(date);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

-- Everyone can view holidays
CREATE POLICY "Anyone can view holidays"
  ON holidays FOR SELECT
  TO authenticated, anon
  USING (true);

-- Admin can manage holidays
CREATE POLICY "Admin can insert holidays"
  ON holidays FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );

CREATE POLICY "Admin can update holidays"
  ON holidays FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );

CREATE POLICY "Admin can delete holidays"
  ON holidays FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );

-- ============================================
-- UPDATE MENU SCHEDULE CONSTRAINT
-- ============================================

-- Remove existing day_of_week constraint and add weekday-only constraint
ALTER TABLE menu_schedules DROP CONSTRAINT IF EXISTS menu_schedules_day_of_week_check;
ALTER TABLE menu_schedules ADD CONSTRAINT menu_schedules_weekday_only 
  CHECK (day_of_week >= 1 AND day_of_week <= 5);
-- 1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday, 5 = Friday

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to check if a date is a holiday
CREATE OR REPLACE FUNCTION is_holiday(check_date DATE DEFAULT CURRENT_DATE)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM holidays WHERE date = check_date);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if canteen is open (weekday and not holiday)
CREATE OR REPLACE FUNCTION is_canteen_open(check_date DATE DEFAULT CURRENT_DATE)
RETURNS BOOLEAN AS $$
DECLARE
  day_num INTEGER;
BEGIN
  day_num := EXTRACT(DOW FROM check_date)::INTEGER;
  -- Check if it's a weekday (1-5) and not a holiday
  RETURN day_num >= 1 AND day_num <= 5 AND NOT is_holiday(check_date);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update get_todays_menu to respect holidays
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
  -- Check if canteen is open
  IF NOT is_canteen_open(CURRENT_DATE) THEN
    RETURN;
  END IF;

  today_dow := EXTRACT(DOW FROM CURRENT_DATE)::INTEGER;
  
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
  WHERE ms.day_of_week = today_dow
    AND ms.is_active = TRUE
    AND p.available = TRUE
  ORDER BY p.category, p.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
