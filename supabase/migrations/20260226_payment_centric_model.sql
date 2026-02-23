-- ============================================
-- PAYMENT-CENTRIC MODEL MIGRATION
-- Replaces per-order `transactions` table with:
--   payments            – one row per real money movement
--   payment_allocations – links each payment to the orders it covers
--
-- Benefits:
--   1. Batch checkout = 1 payment + N allocations (not N transaction rows)
--   2. Easier reconciliation with PayMongo (1:1 with real payment events)
--   3. Cleaner wallet view (one line per real payment)
-- ============================================

-- ── 1. Create `payments` table ──────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,

  -- What kind of money movement
  type TEXT NOT NULL CHECK (type IN ('payment', 'refund', 'topup')),

  -- Total amount of this single real-world payment
  amount_total NUMERIC(10,2) NOT NULL,

  -- How the money moved
  method TEXT NOT NULL CHECK (method IN ('cash', 'gcash', 'paymaya', 'card', 'paymongo', 'balance')),

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed')),

  -- External references (PayMongo)
  external_ref TEXT,                    -- human-readable ref like PAYMONGO-pay_xxx
  paymongo_checkout_id TEXT,
  paymongo_payment_id TEXT,
  paymongo_refund_id TEXT,

  -- Group key so webhook can find the payment row
  payment_group_id UUID,

  -- Freeform ref (admin notes, topup ref, cancel ref, etc.)
  reference_id TEXT,

  -- Optional metadata (future-proof)
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Create `payment_allocations` table ───────────────
-- Links one payment to the N orders it covers.
-- For a single-order payment there is exactly 1 allocation row.
-- For a batch checkout there are N allocation rows summing to amount_total.
CREATE TABLE IF NOT EXISTS payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  allocated_amount NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. Indexes ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payments_parent_id ON payments(parent_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_payments_type ON payments(type);
CREATE INDEX IF NOT EXISTS idx_payments_payment_group_id
  ON payments(payment_group_id) WHERE payment_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_paymongo_checkout_id
  ON payments(paymongo_checkout_id) WHERE paymongo_checkout_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_paymongo_payment_id
  ON payments(paymongo_payment_id) WHERE paymongo_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment_id ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_order_id ON payment_allocations(order_id);

-- ── 4. RLS ──────────────────────────────────────────────
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;

-- Parents see own payments
CREATE POLICY "Parents can view own payments" ON payments
  FOR SELECT USING (parent_id = auth.uid());

-- Staff/admin see all payments
CREATE POLICY "Staff can view all payments" ON payments
  FOR SELECT USING (is_staff_or_admin());

-- Admin can insert (edge functions use service_role which bypasses RLS)
CREATE POLICY "Admin can insert payments" ON payments
  FOR INSERT WITH CHECK (is_admin());

-- Allocations: parents see allocations for their payments
CREATE POLICY "Parents can view own allocations" ON payment_allocations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM payments p
      WHERE p.id = payment_allocations.payment_id
        AND p.parent_id = auth.uid()
    )
  );

-- Staff/admin see all allocations
CREATE POLICY "Staff can view all allocations" ON payment_allocations
  FOR SELECT USING (is_staff_or_admin());

-- ── 5. Rename legacy table (keep data, don't drop) ─────
ALTER TABLE IF EXISTS transactions RENAME TO transactions_legacy;

-- Update RLS on legacy table (keep policies working)
-- The old policies reference 'transactions' — after rename they auto-apply to 'transactions_legacy'

-- ── 6. Backfill: migrate existing transactions → payments + allocations ──
-- Each legacy row becomes one payment + one allocation (1:1 since legacy was per-order)
INSERT INTO payments (
  parent_id, type, amount_total, method, status,
  external_ref, paymongo_checkout_id, paymongo_payment_id, paymongo_refund_id,
  reference_id, created_at
)
SELECT
  parent_id, type, amount, method, status,
  CASE 
    WHEN paymongo_payment_id IS NOT NULL THEN 'PAYMONGO-' || paymongo_payment_id
    ELSE NULL
  END,
  paymongo_checkout_id, paymongo_payment_id, paymongo_refund_id,
  reference_id, created_at
FROM transactions_legacy;

-- Create allocations for payment-type transactions that have an order_id
INSERT INTO payment_allocations (payment_id, order_id, allocated_amount, created_at)
SELECT
  p.id,
  tl.order_id,
  tl.amount,
  tl.created_at
FROM transactions_legacy tl
JOIN payments p ON p.parent_id = tl.parent_id
  AND p.created_at = tl.created_at
  AND p.amount_total = tl.amount
  AND p.type = tl.type
WHERE tl.order_id IS NOT NULL;
