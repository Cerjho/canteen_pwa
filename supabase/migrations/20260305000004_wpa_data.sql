-- =============================================================================
-- Migration 4: Weekly Pre-Order Architecture — Data Migration & Settings
-- =============================================================================
-- Backfills weekly_orders from existing orders, links them, and inserts
-- new system_settings for cutoff configuration.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Fix validate_weekly_order_cutoff timestamp bug (DATE - INTERVAL → TIMESTAMP)
--    Migration 2 already applied this function, so re-create with the fix.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION validate_weekly_order_cutoff()
RETURNS TRIGGER AS $$
DECLARE
  v_cutoff_time TEXT;
  v_cutoff_ts   TIMESTAMPTZ;
  v_now_manila  TIMESTAMPTZ;
BEGIN
  SELECT COALESCE(
    (SELECT value #>> '{}' FROM system_settings WHERE key = 'weekly_cutoff_time'),
    '17:00'
  ) INTO v_cutoff_time;

  -- Cast to DATE first: (DATE - INTERVAL) yields TIMESTAMP, whose ::TEXT includes '00:00:00'
  v_cutoff_ts := ((NEW.week_start - INTERVAL '3 days')::DATE::TEXT
                  || ' ' || v_cutoff_time)::TIMESTAMPTZ AT TIME ZONE 'Asia/Manila';
  v_now_manila := NOW() AT TIME ZONE 'Asia/Manila';

  IF v_now_manila > v_cutoff_ts THEN
    RAISE EXCEPTION
      'Weekly order cutoff has passed. Orders for the week of % closed on Friday at %.',
      NEW.week_start, v_cutoff_time
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 1. Backfill weekly_orders from existing orders grouped by (parent, student, week)
--    Disable cutoff trigger: historical weeks are past cutoff by definition.
-- ---------------------------------------------------------------------------

ALTER TABLE weekly_orders DISABLE TRIGGER trg_validate_weekly_order_cutoff;

INSERT INTO weekly_orders (
  id, parent_id, student_id, week_start, total_amount, status,
  payment_method, payment_status, created_at, updated_at
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
  -- Use the most common VALID payment_method; map deprecated 'balance' → 'cash'
  COALESCE(
    (MODE() WITHIN GROUP (ORDER BY
      CASE WHEN o.payment_method IN ('cash','gcash','paymaya','card')
           THEN o.payment_method
           ELSE 'cash' END
    )),
    'cash'
  )                                          AS payment_method,
  'paid'                                     AS payment_status,
  MIN(o.created_at)                          AS created_at,
  MAX(o.updated_at)                          AS updated_at
FROM orders o
WHERE o.parent_id IS NOT NULL
  AND o.student_id IS NOT NULL
  AND o.scheduled_for IS NOT NULL
GROUP BY o.parent_id, o.student_id, date_trunc('week', o.scheduled_for)::DATE
ON CONFLICT DO NOTHING;

ALTER TABLE weekly_orders ENABLE TRIGGER trg_validate_weekly_order_cutoff;

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
