-- Migration: Atomic order merge function
-- Fixes race condition in concurrent order merges for the same student+date slot
-- Uses SELECT FOR UPDATE to prevent concurrent merge operations

CREATE OR REPLACE FUNCTION merge_order_items(
  p_order_id UUID,
  p_items JSONB,           -- Array of {product_id, quantity, price_at_order, meal_period}
  p_payment_method TEXT,
  p_parent_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order RECORD;
  v_new_total NUMERIC(10,2);
  v_delta NUMERIC(10,2);
  v_wallet_balance NUMERIC(10,2);
  v_payment_id UUID;
  v_item JSONB;
BEGIN
  -- Lock the order row to prevent concurrent merges
  SELECT id, status, total_amount
    INTO v_order
    FROM orders
   WHERE id = p_order_id
     FOR UPDATE SKIP LOCKED;

  -- If we couldn't acquire the lock, another merge is in progress
  IF v_order IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'MERGE_CONFLICT',
      'message', 'Order is being modified by another request. Please retry.'
    );
  END IF;

  -- Verify order is still in a mergeable state
  IF v_order.status NOT IN ('pending', 'awaiting_payment') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ORDER_LOCKED',
      'message', format('Order is already %s. Cannot add items.', v_order.status)
    );
  END IF;

  -- Validate stock and availability before inserting
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS item
    LEFT JOIN products p ON p.id = (item->>'product_id')::UUID
    WHERE p.id IS NULL OR NOT p.available
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PRODUCT_UNAVAILABLE',
      'message', 'One or more products are unavailable'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS item
    JOIN products p ON p.id = (item->>'product_id')::UUID
    WHERE p.stock_quantity < (item->>'quantity')::INTEGER
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INSUFFICIENT_STOCK',
      'message', 'One or more products have insufficient stock'
    );
  END IF;

  -- Insert new items with explicit confirmed status
  INSERT INTO order_items (order_id, product_id, quantity, price_at_order, meal_period, status)
  SELECT
    p_order_id,
    (item->>'product_id')::UUID,
    (item->>'quantity')::INTEGER,
    (item->>'price_at_order')::NUMERIC(10,2),
    COALESCE(item->>'meal_period', 'lunch'),
    'confirmed'
  FROM jsonb_array_elements(p_items) AS item;

  -- Decrement stock for merged items
  UPDATE products SET stock_quantity = stock_quantity - sub.qty
  FROM (
    SELECT (item->>'product_id')::UUID AS pid, (item->>'quantity')::INTEGER AS qty
    FROM jsonb_array_elements(p_items) AS item
  ) sub
  WHERE products.id = sub.pid;

  -- Recalculate total from all confirmed items
  SELECT COALESCE(SUM(price_at_order * quantity), 0)
    INTO v_new_total
    FROM order_items
   WHERE order_id = p_order_id
     AND status = 'confirmed';

  v_delta := v_new_total - COALESCE(v_order.total_amount, 0);

  -- Update the order total
  UPDATE orders SET total_amount = v_new_total, updated_at = NOW()
   WHERE id = p_order_id;

  -- Handle balance payment deduction if needed
  IF p_payment_method = 'balance' AND v_delta > 0 THEN
    SELECT balance INTO v_wallet_balance
      FROM wallets
     WHERE user_id = p_parent_id
       FOR UPDATE;

    IF v_wallet_balance IS NULL THEN
      RAISE EXCEPTION 'NO_WALLET: No wallet found for user';
    END IF;

    IF v_wallet_balance < v_delta THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE: Required %, available %', v_delta, v_wallet_balance;
    END IF;

    UPDATE wallets
       SET balance = balance - v_delta,
           updated_at = NOW()
     WHERE user_id = p_parent_id;

    -- Record the payment
    INSERT INTO payments (parent_id, type, amount_total, method, status, reference_id)
    VALUES (p_parent_id, 'payment', v_delta, 'balance', 'completed', p_order_id::TEXT)
    RETURNING id INTO v_payment_id;

    -- Record the payment allocation for audit trail
    INSERT INTO payment_allocations (payment_id, order_id, allocated_amount)
    VALUES (v_payment_id, p_order_id, v_delta);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'new_total', v_new_total,
    'delta', v_delta,
    'items_added', jsonb_array_length(p_items)
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SPLIT_PART(SQLERRM, ': ', 1),
      'message', COALESCE(SPLIT_PART(SQLERRM, ': ', 2), SQLERRM)
    );
END;
$$;
