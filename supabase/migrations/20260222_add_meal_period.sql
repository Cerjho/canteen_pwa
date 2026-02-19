-- ============================================
-- Add meal_period to orders and cart_items
-- Allows parents to schedule orders for specific meal times:
--   morning_snack, lunch, afternoon_snack
-- ============================================

-- 1. Add meal_period column to orders table
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS meal_period TEXT DEFAULT 'lunch'
    CHECK (meal_period IN ('morning_snack', 'lunch', 'afternoon_snack'));

-- 2. Add meal_period column to cart_items table
ALTER TABLE cart_items
  ADD COLUMN IF NOT EXISTS meal_period TEXT DEFAULT 'lunch'
    CHECK (meal_period IN ('morning_snack', 'lunch', 'afternoon_snack'));

-- 3. Drop old unique constraint and create new one including meal_period
-- The old constraint was (user_id, student_id, product_id, scheduled_for)
ALTER TABLE cart_items
  DROP CONSTRAINT IF EXISTS cart_items_user_student_product_date_key;

ALTER TABLE cart_items
  DROP CONSTRAINT IF EXISTS cart_items_user_id_student_id_product_id_scheduled_for_key;

-- New constraint: same product can appear in different meal periods
ALTER TABLE cart_items
  ADD CONSTRAINT cart_items_user_student_product_date_meal_key
    UNIQUE (user_id, student_id, product_id, scheduled_for, meal_period);

-- 4. Add index for efficient staff queries by meal_period
CREATE INDEX IF NOT EXISTS idx_orders_meal_period ON orders(meal_period);
CREATE INDEX IF NOT EXISTS idx_orders_scheduled_meal ON orders(scheduled_for, meal_period, status);
CREATE INDEX IF NOT EXISTS idx_cart_items_meal_period ON cart_items(meal_period);
