-- ============================================
-- ORDERING FLOW FIXES
-- Phase 1: Critical DB fixes
-- ============================================

-- 1. Create `increment_stock` RPC function
--    Called by paymongo-webhook, cleanup-timeout-orders, manage-order
--    when restoring stock for cancelled/failed orders.
--    Atomic increment avoids read-then-write race conditions.
CREATE OR REPLACE FUNCTION increment_stock(p_product_id UUID, p_quantity INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE products
  SET stock_quantity = stock_quantity + p_quantity
  WHERE id = p_product_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also create an atomic decrement for consistent stock reservation
CREATE OR REPLACE FUNCTION decrement_stock(p_product_id UUID, p_quantity INTEGER)
RETURNS VOID AS $$
DECLARE
  current_stock INTEGER;
BEGIN
  SELECT stock_quantity INTO current_stock
  FROM products
  WHERE id = p_product_id
  FOR UPDATE; -- Row lock to prevent concurrent deductions
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;
  
  IF current_stock < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock for product %. Available: %, Requested: %',
      p_product_id, current_stock, p_quantity;
  END IF;
  
  UPDATE products
  SET stock_quantity = stock_quantity - p_quantity
  WHERE id = p_product_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users (edge functions use service_role which bypasses)
GRANT EXECUTE ON FUNCTION increment_stock(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION decrement_stock(UUID, INTEGER) TO authenticated;


-- 2. Add 'failed' to payment_status ENUM
--    The webhook writes 'failed' on payment.failed events,
--    but the ENUM only has: awaiting_payment, paid, timeout, refunded
DO $$ BEGIN
  ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'failed';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;


-- 3. Create order status transition validation trigger
--    Enforces valid state machine transitions at the DB level
CREATE OR REPLACE FUNCTION validate_order_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip if status hasn't changed
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Define valid transitions
  CASE OLD.status
    WHEN 'awaiting_payment' THEN
      IF NEW.status NOT IN ('pending', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transition from awaiting_payment to %', NEW.status;
      END IF;
    WHEN 'pending' THEN
      IF NEW.status NOT IN ('preparing', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transition from pending to %', NEW.status;
      END IF;
    WHEN 'preparing' THEN
      IF NEW.status NOT IN ('ready', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transition from preparing to %', NEW.status;
      END IF;
    WHEN 'ready' THEN
      IF NEW.status NOT IN ('completed', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transition from ready to %', NEW.status;
      END IF;
    WHEN 'completed' THEN
      RAISE EXCEPTION 'Cannot transition from completed status';
    WHEN 'cancelled' THEN
      RAISE EXCEPTION 'Cannot transition from cancelled status';
    ELSE
      -- Unknown status, allow (forward compat)
      NULL;
  END CASE;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_order_status_trigger ON orders;
CREATE TRIGGER validate_order_status_trigger
  BEFORE UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION validate_order_status_transition();
