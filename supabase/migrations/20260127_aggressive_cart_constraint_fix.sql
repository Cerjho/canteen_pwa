-- Aggressively fix cart_items unique constraint
-- Drop any constraint that doesn't include scheduled_for

-- First, let's see what we have and drop anything that matches pattern
DO $$
DECLARE
  constraint_rec RECORD;
BEGIN
  -- Loop through all unique constraints on cart_items
  FOR constraint_rec IN 
    SELECT constraint_name 
    FROM information_schema.table_constraints 
    WHERE table_name = 'cart_items' 
      AND constraint_type = 'UNIQUE'
      AND constraint_name NOT LIKE '%date%'  -- Keep constraints with 'date' in name
  LOOP
    EXECUTE format('ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS %I', constraint_rec.constraint_name);
    RAISE NOTICE 'Dropped constraint: %', constraint_rec.constraint_name;
  END LOOP;
END $$;

-- Ensure the correct constraint exists
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_user_student_product_date_key;
ALTER TABLE cart_items 
  ADD CONSTRAINT cart_items_user_student_product_date_key 
  UNIQUE (user_id, student_id, product_id, scheduled_for);
