-- Migration: Multi-day cart support - fix constraints and add validation
-- Allows parents to plan orders for the entire week (Mon-Fri + makeup Saturdays)

-- =====================================================
-- 1. FIX UNIQUE CONSTRAINT
-- Currently: (user_id, student_id, product_id)
-- Should be: (user_id, student_id, product_id, scheduled_for)
-- This allows same product for same student on different days
-- =====================================================

-- Drop the old constraint if it exists
DO $$ 
BEGIN
  -- Try dropping old constraint (may have different names)
  ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_user_id_student_id_product_id_key;
  ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_user_student_product_unique;
  ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS unique_cart_item;
EXCEPTION WHEN OTHERS THEN
  NULL; -- Ignore if doesn't exist
END $$;

-- Add the new constraint including scheduled_for
ALTER TABLE cart_items 
ADD CONSTRAINT cart_items_user_student_product_date_unique 
UNIQUE (user_id, student_id, product_id, scheduled_for);

-- =====================================================
-- 2. ADD INDEX FOR DATE-BASED QUERIES
-- Improves performance for fetching cart items by date range
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_cart_items_scheduled_for ON cart_items(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_cart_items_user_date ON cart_items(user_id, scheduled_for);

-- =====================================================
-- 3. ADD VALIDATION FUNCTION
-- Prevents adding items for invalid dates (past, weekends, holidays)
-- =====================================================

CREATE OR REPLACE FUNCTION validate_cart_item_date()
RETURNS TRIGGER AS $$
DECLARE
  day_of_week INTEGER;
  is_holiday BOOLEAN;
  is_makeup_day BOOLEAN;
  today_ph DATE;
BEGIN
  -- Get today's date in Philippines timezone (UTC+8)
  today_ph := (NOW() AT TIME ZONE 'Asia/Manila')::DATE;
  
  -- Check if date is in the past
  IF NEW.scheduled_for < today_ph THEN
    RAISE EXCEPTION 'Cannot add items for past dates. Selected: %, Today: %', NEW.scheduled_for, today_ph;
  END IF;
  
  -- Get day of week (0 = Sunday, 6 = Saturday)
  day_of_week := EXTRACT(DOW FROM NEW.scheduled_for);
  
  -- Check if it's a Sunday (always closed)
  IF day_of_week = 0 THEN
    RAISE EXCEPTION 'Cannot add items for Sundays. The canteen is closed.';
  END IF;
  
  -- Check if it's a Saturday
  IF day_of_week = 6 THEN
    -- Saturday is only valid if it's a makeup day
    SELECT EXISTS(
      SELECT 1 FROM makeup_days WHERE date = NEW.scheduled_for
    ) INTO is_makeup_day;
    
    IF NOT is_makeup_day THEN
      RAISE EXCEPTION 'Cannot add items for Saturdays unless it is a make-up class day.';
    END IF;
  END IF;
  
  -- Check if it's a holiday (check both exact date and recurring)
  SELECT EXISTS(
    SELECT 1 FROM holidays 
    WHERE (date = NEW.scheduled_for) 
       OR (is_recurring = true AND 
           EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM NEW.scheduled_for) AND
           EXTRACT(DAY FROM date) = EXTRACT(DAY FROM NEW.scheduled_for))
  ) INTO is_holiday;
  
  IF is_holiday THEN
    RAISE EXCEPTION 'Cannot add items for holidays. The canteen is closed on this date.';
  END IF;
  
  -- All validations passed
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for validation on insert and update
DROP TRIGGER IF EXISTS validate_cart_item_date_trigger ON cart_items;
CREATE TRIGGER validate_cart_item_date_trigger
  BEFORE INSERT OR UPDATE OF scheduled_for ON cart_items
  FOR EACH ROW
  EXECUTE FUNCTION validate_cart_item_date();

-- =====================================================
-- 4. ADD FUNCTION TO CLEAN UP PAST CART ITEMS
-- Can be called manually or via scheduled job
-- =====================================================

CREATE OR REPLACE FUNCTION cleanup_past_cart_items()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
  today_ph DATE;
BEGIN
  -- Get today's date in Philippines timezone
  today_ph := (NOW() AT TIME ZONE 'Asia/Manila')::DATE;
  
  -- Delete cart items for past dates
  DELETE FROM cart_items 
  WHERE scheduled_for < today_ph;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 5. ADD LIMIT ON ADVANCE ORDERING (14 days max)
-- Prevents orders too far in the future
-- =====================================================

CREATE OR REPLACE FUNCTION validate_cart_item_max_advance()
RETURNS TRIGGER AS $$
DECLARE
  today_ph DATE;
  max_advance_days INTEGER := 14;
BEGIN
  -- Get today's date in Philippines timezone
  today_ph := (NOW() AT TIME ZONE 'Asia/Manila')::DATE;
  
  -- Check if date is too far in the future
  IF NEW.scheduled_for > today_ph + max_advance_days THEN
    RAISE EXCEPTION 'Cannot add items more than % days in advance.', max_advance_days;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_cart_item_max_advance_trigger ON cart_items;
CREATE TRIGGER validate_cart_item_max_advance_trigger
  BEFORE INSERT OR UPDATE OF scheduled_for ON cart_items
  FOR EACH ROW
  EXECUTE FUNCTION validate_cart_item_max_advance();

-- =====================================================
-- 6. COMMENT FOR DOCUMENTATION
-- =====================================================

COMMENT ON COLUMN cart_items.scheduled_for IS 'The date when the order is intended for. Must be a valid school day (Mon-Fri or makeup Saturday), not a holiday, not in the past, and within 14 days.';
