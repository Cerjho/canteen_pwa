-- Phase 1: Order Slot Uniqueness
-- Prevent two active orders for the same student + date + meal_period slot.
-- Part of the Order Granularity Hardening plan.

-- First, resolve any existing duplicate active orders for the same slot
-- by cancelling the older duplicates (keep the most recent one).
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY student_id, scheduled_for, meal_period
           ORDER BY created_at DESC
         ) AS rn
  FROM orders
  WHERE status NOT IN ('cancelled')
)
UPDATE orders
SET status = 'cancelled'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Unique partial index: prevents duplicate active orders for the same slot
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_order_per_slot
  ON orders(student_id, scheduled_for, meal_period)
  WHERE status NOT IN ('cancelled');

-- Composite lookup index for fast slot queries
CREATE INDEX IF NOT EXISTS idx_orders_student_date_meal
  ON orders(student_id, scheduled_for, meal_period);
