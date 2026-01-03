-- Add cart_state table for persisting selected student
-- Update cart_items to be per-student instead of per-user

-- ============================================
-- CART STATE TABLE (stores selected student only)
-- ============================================
CREATE TABLE IF NOT EXISTS cart_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for cart_state
ALTER TABLE cart_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own cart state"
  ON cart_state FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own cart state"
  ON cart_state FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own cart state"
  ON cart_state FOR UPDATE
  USING (auth.uid() = user_id);

-- ============================================
-- Update cart_items to be per-student
-- ============================================
-- Add student_id column to cart_items
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students(id) ON DELETE CASCADE;

-- Update the unique constraint to be per-user-per-student-per-product
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_user_id_product_id_key;
ALTER TABLE cart_items ADD CONSTRAINT cart_items_user_student_product_key UNIQUE (user_id, student_id, product_id);

-- Index for fast lookups by student
CREATE INDEX IF NOT EXISTS idx_cart_items_student_id ON cart_items(student_id);
