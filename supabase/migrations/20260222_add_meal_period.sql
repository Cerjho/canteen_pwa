-- Add meal_period column to orders and cart_items
-- Allows parents to choose when snacks are served (morning or afternoon)
-- Mains default to 'lunch', drinks to 'afternoon_snack', snacks chosen by parent

-- Add meal_period to orders table
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS meal_period TEXT NOT NULL DEFAULT 'lunch'
CHECK (meal_period IN ('morning_snack', 'lunch', 'afternoon_snack'));

-- Add meal_period to cart_items table
ALTER TABLE cart_items
ADD COLUMN IF NOT EXISTS meal_period TEXT NOT NULL DEFAULT 'lunch'
CHECK (meal_period IN ('morning_snack', 'lunch', 'afternoon_snack'));

-- Update cart_items unique constraint to include meal_period
-- This allows the same product for the same student on the same day but different meal periods
DROP INDEX IF EXISTS cart_items_user_student_product_date_key;
DROP INDEX IF EXISTS cart_items_user_student_product_date_meal_key;

CREATE UNIQUE INDEX cart_items_user_student_product_date_meal_key
ON cart_items (user_id, student_id, product_id, scheduled_for, meal_period);
