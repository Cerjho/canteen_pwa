-- Add student_id column to cart_items for per-student carts

-- Add student_id column to cart_items
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students(id) ON DELETE CASCADE;

-- Drop the old unique constraint
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_user_id_product_id_key;

-- Add new unique constraint for per-user-per-student-per-product
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_user_student_product_key'
  ) THEN
    ALTER TABLE cart_items ADD CONSTRAINT cart_items_user_student_product_key UNIQUE (user_id, student_id, product_id);
  END IF;
END $$;

-- Index for fast lookups by student
CREATE INDEX IF NOT EXISTS idx_cart_items_student_id ON cart_items(student_id);

-- Clean up any existing cart items that don't have a student_id (they'll need to be re-added)
DELETE FROM cart_items WHERE student_id IS NULL;
