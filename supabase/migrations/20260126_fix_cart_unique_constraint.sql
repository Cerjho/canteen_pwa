-- Fix cart_items unique constraint to include scheduled_for
-- The old constraint cart_items_user_student_product_key prevents same product on different dates

-- Drop ALL old constraints that don't include scheduled_for
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_user_student_product_key;
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_user_student_product_unique;
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS unique_cart_item;
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_user_id_student_id_product_id_key;

-- Ensure the new constraint exists (with scheduled_for)
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_user_student_product_date_key;
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_user_student_product_date_unique;
ALTER TABLE cart_items 
  ADD CONSTRAINT cart_items_user_student_product_date_key 
  UNIQUE (user_id, student_id, product_id, scheduled_for);
