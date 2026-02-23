-- ============================================
-- PAYMENT FINANCIAL HARDENING
-- Enforces invariants that prevent silent financial drift:
--   1. Allocation integrity (SUM = amount_total)
--   2. Amount immutability (append-only ledger)
--   3. Webhook idempotency (UNIQUE external refs)
--   4. Wallet consistency (atomic debit via RPC)
--   5. Refund lineage (original_payment_id)
--   6. Legacy table lockdown (read-only)
-- ============================================

-- ── 1. ALLOCATION INTEGRITY ─────────────────────────────
-- Trigger: on INSERT/UPDATE/DELETE on payment_allocations,
-- verify SUM(allocated_amount) <= payments.amount_total.
-- Runs AFTER each statement so the full batch is visible.

CREATE OR REPLACE FUNCTION check_allocation_integrity()
RETURNS TRIGGER AS $$
DECLARE
  v_payment_id UUID;
  v_alloc_sum  NUMERIC(10,2);
  v_total      NUMERIC(10,2);
BEGIN
  -- Determine which payment_id to check
  IF TG_OP = 'DELETE' THEN
    v_payment_id := OLD.payment_id;
  ELSE
    v_payment_id := NEW.payment_id;
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_alloc_sum
  FROM payment_allocations
  WHERE payment_id = v_payment_id;

  SELECT amount_total INTO v_total
  FROM payments
  WHERE id = v_payment_id;

  IF v_alloc_sum > v_total THEN
    RAISE EXCEPTION 'Allocation integrity violation: SUM(allocated_amount)=% exceeds payments.amount_total=% for payment %',
      v_alloc_sum, v_total, v_payment_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_allocation_integrity ON payment_allocations;
CREATE CONSTRAINT TRIGGER trg_check_allocation_integrity
  AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_allocation_integrity();

-- ── 2. AMOUNT IMMUTABILITY ──────────────────────────────
-- Prevent any UPDATE to amount_total on payments.
-- Only status, method, external_ref, paymongo_* may change.

CREATE OR REPLACE FUNCTION prevent_amount_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.amount_total IS DISTINCT FROM NEW.amount_total THEN
    RAISE EXCEPTION 'Payments are append-only: amount_total cannot be modified (payment %).',
      OLD.id;
  END IF;
  IF OLD.type IS DISTINCT FROM NEW.type THEN
    RAISE EXCEPTION 'Payments are append-only: type cannot be modified (payment %).',
      OLD.id;
  END IF;
  IF OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN
    RAISE EXCEPTION 'Payments are append-only: parent_id cannot be modified (payment %).',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_amount_mutation ON payments;
CREATE TRIGGER trg_prevent_amount_mutation
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION prevent_amount_mutation();

-- Also prevent mutation of allocated_amount
CREATE OR REPLACE FUNCTION prevent_allocation_amount_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.allocated_amount IS DISTINCT FROM NEW.allocated_amount THEN
    RAISE EXCEPTION 'Payment allocations are append-only: allocated_amount cannot be modified (allocation %).',
      OLD.id;
  END IF;
  IF OLD.payment_id IS DISTINCT FROM NEW.payment_id THEN
    RAISE EXCEPTION 'Payment allocations are append-only: payment_id cannot be modified (allocation %).',
      OLD.id;
  END IF;
  IF OLD.order_id IS DISTINCT FROM NEW.order_id THEN
    RAISE EXCEPTION 'Payment allocations are append-only: order_id cannot be modified (allocation %).',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_allocation_amount_mutation ON payment_allocations;
CREATE TRIGGER trg_prevent_allocation_amount_mutation
  BEFORE UPDATE ON payment_allocations
  FOR EACH ROW
  EXECUTE FUNCTION prevent_allocation_amount_mutation();

-- ── 3. WEBHOOK IDEMPOTENCY ──────────────────────────────
-- UNIQUE partial indexes on external payment IDs.
-- Prevents double-insert from webhook retries.
-- First, deduplicate existing rows (keep the newest row per external ID).

-- Deduplicate paymongo_payment_id
DELETE FROM payments
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY paymongo_payment_id ORDER BY created_at DESC) rn
    FROM payments
    WHERE paymongo_payment_id IS NOT NULL
  ) sub WHERE rn > 1
);

-- Deduplicate paymongo_checkout_id
DELETE FROM payments
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY paymongo_checkout_id ORDER BY created_at DESC) rn
    FROM payments
    WHERE paymongo_checkout_id IS NOT NULL
  ) sub WHERE rn > 1
);

-- Deduplicate paymongo_refund_id
DELETE FROM payments
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY paymongo_refund_id ORDER BY created_at DESC) rn
    FROM payments
    WHERE paymongo_refund_id IS NOT NULL
  ) sub WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_paymongo_payment_id
  ON payments(paymongo_payment_id)
  WHERE paymongo_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_paymongo_checkout_id
  ON payments(paymongo_checkout_id)
  WHERE paymongo_checkout_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_paymongo_refund_id
  ON payments(paymongo_refund_id)
  WHERE paymongo_refund_id IS NOT NULL;

-- Status transition guard: only pending → completed or pending → failed
CREATE OR REPLACE FUNCTION guard_payment_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow no-op (same status)
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Valid transitions: pending → completed, pending → failed
  IF OLD.status = 'pending' AND NEW.status IN ('completed', 'failed') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid payment status transition: % → % (payment %)',
    OLD.status, NEW.status, OLD.id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_payment_status ON payments;
CREATE TRIGGER trg_guard_payment_status
  BEFORE UPDATE OF status ON payments
  FOR EACH ROW
  EXECUTE FUNCTION guard_payment_status_transition();

-- ── 4. WALLET CONSISTENCY ───────────────────────────────
-- Atomic RPC that deducts wallet and inserts payment + allocations
-- in a single DB transaction. Returns the payment ID.

CREATE OR REPLACE FUNCTION deduct_balance_with_payment(
  p_parent_id UUID,
  p_expected_balance NUMERIC(10,2),
  p_amount NUMERIC(10,2),
  p_order_ids UUID[],
  p_order_amounts NUMERIC(10,2)[]
)
RETURNS UUID AS $$
DECLARE
  v_payment_id UUID;
  v_new_balance NUMERIC(10,2);
  v_rows_updated INT;
  i INT;
BEGIN
  -- Validate arrays match
  IF array_length(p_order_ids, 1) != array_length(p_order_amounts, 1) THEN
    RAISE EXCEPTION 'order_ids and order_amounts arrays must have same length';
  END IF;

  -- Atomic balance deduction with optimistic lock
  v_new_balance := p_expected_balance - p_amount;
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient balance: have %, need %', p_expected_balance, p_amount;
  END IF;

  UPDATE wallets
  SET balance = v_new_balance, updated_at = NOW()
  WHERE user_id = p_parent_id AND balance = p_expected_balance;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION 'Balance changed concurrently, please retry';
  END IF;

  -- Insert payment
  INSERT INTO payments (parent_id, type, amount_total, method, status)
  VALUES (p_parent_id, 'payment', p_amount, 'balance', 'completed')
  RETURNING id INTO v_payment_id;

  -- Insert allocations
  FOR i IN 1..array_length(p_order_ids, 1) LOOP
    INSERT INTO payment_allocations (payment_id, order_id, allocated_amount)
    VALUES (v_payment_id, p_order_ids[i], p_order_amounts[i]);
  END LOOP;

  RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql;

-- Atomic RPC for wallet credit (refund/topup) + payment record
CREATE OR REPLACE FUNCTION credit_balance_with_payment(
  p_parent_id UUID,
  p_amount NUMERIC(10,2),
  p_type TEXT,        -- 'refund' or 'topup'
  p_method TEXT,
  p_reference_id TEXT DEFAULT NULL,
  p_order_id UUID DEFAULT NULL,
  p_external_ref TEXT DEFAULT NULL,
  p_paymongo_refund_id TEXT DEFAULT NULL,
  p_paymongo_payment_id TEXT DEFAULT NULL,
  p_paymongo_checkout_id TEXT DEFAULT NULL,
  p_original_payment_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_payment_id UUID;
  v_current NUMERIC(10,2);
BEGIN
  -- Lock wallet row and get current balance
  SELECT balance INTO v_current
  FROM wallets
  WHERE user_id = p_parent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Create wallet if it doesn't exist
    INSERT INTO wallets (user_id, balance) VALUES (p_parent_id, 0);
    v_current := 0;
  END IF;

  -- Credit wallet
  UPDATE wallets
  SET balance = v_current + p_amount, updated_at = NOW()
  WHERE user_id = p_parent_id;

  -- Insert payment record
  INSERT INTO payments (
    parent_id, type, amount_total, method, status,
    reference_id, external_ref,
    paymongo_refund_id, paymongo_payment_id, paymongo_checkout_id,
    original_payment_id
  ) VALUES (
    p_parent_id, p_type, p_amount, p_method, 'completed',
    p_reference_id, p_external_ref,
    p_paymongo_refund_id, p_paymongo_payment_id, p_paymongo_checkout_id,
    p_original_payment_id
  ) RETURNING id INTO v_payment_id;

  -- Link to order if provided
  IF p_order_id IS NOT NULL THEN
    INSERT INTO payment_allocations (payment_id, order_id, allocated_amount)
    VALUES (v_payment_id, p_order_id, p_amount);
  END IF;

  RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql;

-- ── 5. REFUND LINEAGE ───────────────────────────────────
-- Add original_payment_id to payments for refund traceability.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS original_payment_id UUID REFERENCES payments(id);

CREATE INDEX IF NOT EXISTS idx_payments_original_payment_id
  ON payments(original_payment_id) WHERE original_payment_id IS NOT NULL;

-- ── 6. LEGACY TABLE LOCKDOWN ────────────────────────────
-- Revoke INSERT, UPDATE, DELETE from all roles on transactions_legacy.
-- service_role (superuser) can still read for migration verification.

DO $$
BEGIN
  -- Revoke modification privileges
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'transactions_legacy') THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON transactions_legacy FROM authenticated';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON transactions_legacy FROM anon';
    -- Add a protective trigger as defense-in-depth
    CREATE OR REPLACE FUNCTION block_legacy_writes()
    RETURNS TRIGGER AS $fn$
    BEGIN
      RAISE EXCEPTION 'transactions_legacy is read-only. Use payments + payment_allocations instead.';
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_block_legacy_writes ON transactions_legacy;
    CREATE TRIGGER trg_block_legacy_writes
      BEFORE INSERT OR UPDATE OR DELETE ON transactions_legacy
      FOR EACH ROW
      EXECUTE FUNCTION block_legacy_writes();
  END IF;
END;
$$;
