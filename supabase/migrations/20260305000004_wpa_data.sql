-- =============================================================================
-- Migration 4: Weekly Pre-Order Architecture — Data Migration & Settings
-- =============================================================================
-- Backfills weekly_orders from existing orders, links them, and inserts
-- new system_settings for cutoff configuration.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Backfill weekly_orders from existing orders grouped by (parent, student, week)
-- ---------------------------------------------------------------------------

INSERT INTO weekly_orders (
  id, parent_id, student_id, week_start, total_amount, status, payment_status, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  o.parent_id,
  o.student_id,
  date_trunc('week', o.scheduled_for)::DATE AS week_start,
  SUM(o.total_amount)                       AS total_amount,
  CASE
    WHEN COUNT(*) FILTER (WHERE o.status = 'cancelled') = COUNT(*) THEN 'cancelled'
    WHEN COUNT(*) FILTER (WHERE o.status IN ('completed','cancelled')) = COUNT(*) THEN 'completed'
    ELSE 'completed'
  END::TEXT                                  AS status,
  'paid'                                     AS payment_status,
  MIN(o.created_at)                          AS created_at,
  MAX(o.updated_at)                          AS updated_at
FROM orders o
WHERE o.parent_id IS NOT NULL
  AND o.student_id IS NOT NULL
  AND o.scheduled_for IS NOT NULL
GROUP BY o.parent_id, o.student_id, date_trunc('week', o.scheduled_for)::DATE
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Link existing orders to their weekly_orders
-- ---------------------------------------------------------------------------

UPDATE orders o
SET weekly_order_id = wo.id,
    order_type     = 'pre_order'
FROM weekly_orders wo
WHERE o.parent_id   = wo.parent_id
  AND o.student_id  = wo.student_id
  AND date_trunc('week', o.scheduled_for)::DATE = wo.week_start
  AND o.weekly_order_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Set order_type for any remaining unlinked orders
-- ---------------------------------------------------------------------------

UPDATE orders
SET order_type = 'pre_order'
WHERE order_type IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Insert / update system_settings for weekly ordering
-- ---------------------------------------------------------------------------

INSERT INTO system_settings (key, value, updated_by, updated_at)
VALUES
  ('weekly_cutoff_day',        '"friday"',  NULL, NOW()),
  ('weekly_cutoff_time',       '"17:00"',   NULL, NOW()),
  ('surplus_cutoff_time',      '"08:00"',   NULL, NOW()),
  ('daily_cancel_cutoff_time', '"08:00"',   NULL, NOW())
ON CONFLICT (key) DO UPDATE
  SET value      = EXCLUDED.value,
      updated_at = NOW();

-- ---------------------------------------------------------------------------
-- 5. Remove deprecated system_settings
-- ---------------------------------------------------------------------------

DELETE FROM system_settings
WHERE key IN (
  'order_cutoff_time',
  'max_future_days',
  'low_stock_threshold',
  'topup_minimum',
  'topup_maximum',
  'balance_low_threshold',
  'max_advance_order_days'
);

COMMIT;
