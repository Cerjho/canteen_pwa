-- Migration: Add support for future orders (advance ordering)
-- Parents can order food for future dates

-- Add scheduled_for column to orders table
ALTER TABLE orders 
ADD COLUMN scheduled_for DATE DEFAULT CURRENT_DATE;

-- Add index for querying orders by scheduled date
CREATE INDEX idx_orders_scheduled_for ON orders(scheduled_for);

-- Comment for documentation
COMMENT ON COLUMN orders.scheduled_for IS 'The date when the order should be fulfilled. Defaults to current date for immediate orders.';

-- Update menu_schedules to support weekly patterns (already exists but ensure it works for any week)
-- The day_of_week column already supports this since it's 1-5 for Mon-Fri

-- Create function to check if menu is available for a given date
CREATE OR REPLACE FUNCTION is_menu_available(check_date DATE)
RETURNS BOOLEAN AS $$
DECLARE
  day_num INTEGER;
  is_hol BOOLEAN;
BEGIN
  -- Get day of week (0=Sunday, 6=Saturday in PostgreSQL)
  day_num := EXTRACT(DOW FROM check_date);
  
  -- Check if weekend
  IF day_num = 0 OR day_num = 6 THEN
    RETURN FALSE;
  END IF;
  
  -- Check if holiday
  SELECT EXISTS(SELECT 1 FROM holidays WHERE date = check_date) INTO is_hol;
  IF is_hol THEN
    RETURN FALSE;
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get menu for a specific date
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
  -- Get day of week (PostgreSQL: 0=Sunday, need to convert to our format 1=Monday)
  day_num := EXTRACT(DOW FROM target_date);
  -- Convert to our format: Mon=1, Tue=2, ... Fri=5
  -- PostgreSQL: Sun=0, Mon=1, Tue=2, ... Sat=6
  
  -- If weekend, return nothing
  IF day_num = 0 OR day_num = 6 THEN
    RETURN;
  END IF;
  
  -- Check if holiday
  IF EXISTS(SELECT 1 FROM holidays WHERE date = target_date) THEN
    RETURN;
  END IF;
  
  -- Return products scheduled for that day
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
  WHERE ms.day_of_week = day_num
    AND ms.is_active = true
    AND p.available = true
  ORDER BY p.category, p.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
