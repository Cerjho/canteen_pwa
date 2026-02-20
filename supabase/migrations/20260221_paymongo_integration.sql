-- ============================================
-- PayMongo Payment Integration Migration
-- Adds support for GCash, PayMaya, and Card payments via PayMongo
-- ============================================

-- 1. Add PayMongo reference columns to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paymongo_checkout_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paymongo_payment_id TEXT;

-- 2. Add PayMongo references to transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS paymongo_payment_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS paymongo_refund_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS paymongo_checkout_id TEXT;

-- 3. Update payment_method constraints to include paymaya and card
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('cash', 'balance', 'gcash', 'paymaya', 'card', 'paymongo'));

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_method_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_method_check
  CHECK (method IN ('cash', 'gcash', 'paymaya', 'card', 'paymongo', 'balance'));

ALTER TABLE cart_state DROP CONSTRAINT IF EXISTS cart_state_payment_method_check;
ALTER TABLE cart_state ADD CONSTRAINT cart_state_payment_method_check
  CHECK (payment_method IN ('cash', 'gcash', 'paymaya', 'card', 'balance'));

-- 4. Create topup_sessions table for self-service wallet top-ups
CREATE TABLE IF NOT EXISTS topup_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 50 AND amount <= 50000),
  paymongo_checkout_id TEXT NOT NULL,
  paymongo_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'expired', 'failed')),
  payment_method TEXT, -- filled after payment: 'gcash', 'paymaya', 'card'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);

-- 5. Indexes for webhook/status lookups
CREATE INDEX IF NOT EXISTS idx_orders_paymongo_checkout_id
  ON orders(paymongo_checkout_id) WHERE paymongo_checkout_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_paymongo_payment_id
  ON orders(paymongo_payment_id) WHERE paymongo_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_paymongo_payment_id
  ON transactions(paymongo_payment_id) WHERE paymongo_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_topup_sessions_parent_id ON topup_sessions(parent_id);
CREATE INDEX IF NOT EXISTS idx_topup_sessions_checkout_id ON topup_sessions(paymongo_checkout_id);
CREATE INDEX IF NOT EXISTS idx_topup_sessions_status ON topup_sessions(status) WHERE status = 'pending';

-- 6. RLS for topup_sessions
ALTER TABLE topup_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parents_view_own_topups" ON topup_sessions
  FOR SELECT USING (auth.uid() = parent_id);

-- Edge functions use service_role key which bypasses RLS for insert/update
