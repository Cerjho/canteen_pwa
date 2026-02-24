-- Phase 3: Consolidate meal_period from orders to order_items
-- All items for the same student+date go into one order regardless of meal period.

-- 1. Add meal_period to order_items
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS meal_period TEXT DEFAULT 'lunch'
  CHECK (meal_period IN ('morning_snack', 'lunch', 'afternoon_snack'));

-- 2. Backfill from parent order
UPDATE order_items oi
  SET meal_period = COALESCE(o.meal_period, 'lunch')
  FROM orders o
  WHERE oi.order_id = o.id;

-- 3. Merge duplicate active orders for the same student+date (different meal periods)
-- Move items from duplicate orders into the keeper (most recent), then cancel duplicates.
WITH ranked AS (
  SELECT id, student_id, scheduled_for,
         ROW_NUMBER() OVER (
           PARTITION BY student_id, scheduled_for
           ORDER BY created_at DESC
         ) AS rn
  FROM orders
  WHERE status NOT IN ('cancelled')
),
keeper AS (
  SELECT student_id, scheduled_for, id AS keeper_id
  FROM ranked WHERE rn = 1
),
dups AS (
  SELECT r.id AS dup_id, k.keeper_id
  FROM ranked r
  JOIN keeper k ON r.student_id = k.student_id AND r.scheduled_for = k.scheduled_for
  WHERE r.rn > 1
)
-- Move items from duplicate orders to the keeper
UPDATE order_items oi
SET order_id = d.keeper_id
FROM dups d
WHERE oi.order_id = d.dup_id;

-- Cancel the now-empty duplicate orders
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY student_id, scheduled_for
           ORDER BY created_at DESC
         ) AS rn
  FROM orders
  WHERE status NOT IN ('cancelled')
)
UPDATE orders
SET status = 'cancelled'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Recalculate total_amount for keeper orders that received merged items
UPDATE orders o
SET total_amount = sub.new_total
FROM (
  SELECT oi.order_id, SUM(oi.price_at_order * oi.quantity) AS new_total
  FROM order_items oi
  WHERE oi.status = 'confirmed'
  GROUP BY oi.order_id
) sub
WHERE o.id = sub.order_id
  AND o.status NOT IN ('cancelled');

-- 4. Replace unique index: (student, date, meal_period) → (student, date)
DROP INDEX IF EXISTS idx_unique_order_per_slot;
CREATE UNIQUE INDEX idx_unique_order_per_student_date
  ON orders(student_id, scheduled_for)
  WHERE status NOT IN ('cancelled');

-- 5. Replace composite index
DROP INDEX IF EXISTS idx_orders_student_date_meal;
CREATE INDEX idx_orders_student_date
  ON orders(student_id, scheduled_for);

-- 6. Deprecate orders.meal_period (keep nullable for backward compat)
COMMENT ON COLUMN orders.meal_period IS 'DEPRECATED: Use order_items.meal_period instead';
