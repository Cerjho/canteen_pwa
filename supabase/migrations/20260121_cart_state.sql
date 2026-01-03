-- Add cart_state table for persisting selected student, notes, payment method

-- ============================================
-- CART STATE TABLE (stores student_id, notes, payment_method)
-- ============================================
CREATE TABLE IF NOT EXISTS cart_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  notes TEXT DEFAULT '',
  payment_method TEXT DEFAULT 'cash' CHECK (payment_method IN ('cash', 'gcash', 'balance')),
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
