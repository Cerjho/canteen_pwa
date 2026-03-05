-- =============================================================================
-- Migration 2: Weekly Pre-Order Architecture — Functions & Triggers
-- =============================================================================
-- Creates new functions and triggers, rewrites cart validation,
-- drops redundant triggers.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. REWRITE: validate_cart_item_date()
-- ---------------------------------------------------------------------------
-- Enforces that cart items target the NEXT orderable week only (Mon–Fri).
-- Before Friday 5 PM cutoff → next week. After cutoff → week after next.

CREATE OR REPLACE FUNCTION validate_cart_item_date()
RETURNS TRIGGER AS $$
DECLARE
  v_now_ph       TIMESTAMPTZ;
  v_today        DATE;
  v_dow          INT;
  v_cutoff_time  TEXT;
  v_cutoff_ts    TIMESTAMPTZ;
  v_this_friday  DATE;
  v_next_monday  DATE;
  v_next_friday  DATE;
BEGIN
  v_now_ph := NOW() AT TIME ZONE 'Asia/Manila';
  v_today  := v_now_ph::DATE;
  v_dow    := EXTRACT(ISODOW FROM NEW.scheduled_for);

  -- No past dates
  IF NEW.scheduled_for < v_today THEN
    RAISE EXCEPTION 'Cannot add items for past dates.' USING ERRCODE = 'P0010';
  END IF;

  -- No Sundays (ISO 7)
  IF v_dow = 7 THEN
    RAISE EXCEPTION 'Canteen is closed on Sundays.' USING ERRCODE = 'P0011';
  END IF;

  -- Saturdays only if makeup day
  IF v_dow = 6 THEN
    IF NOT EXISTS (SELECT 1 FROM makeup_days WHERE date = NEW.scheduled_for) THEN
      RAISE EXCEPTION 'Canteen is closed on Saturdays unless it is a makeup day.'
        USING ERRCODE = 'P0012';
    END IF;
  END IF;

  -- No holidays
  IF EXISTS (
    SELECT 1 FROM holidays
    WHERE date = NEW.scheduled_for
       OR (is_recurring
           AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM NEW.scheduled_for)
           AND EXTRACT(DAY   FROM date) = EXTRACT(DAY   FROM NEW.scheduled_for))
  ) THEN
    RAISE EXCEPTION 'Canteen is closed on this holiday.' USING ERRCODE = 'P0013';
  END IF;

  -- Determine the next orderable week
  v_next_monday := v_today + ((8 - EXTRACT(ISODOW FROM v_today)::INT) % 7 + 1);

  SELECT COALESCE(
    (SELECT value #>> '{}' FROM system_settings WHERE key = 'weekly_cutoff_time'),
    '17:00'
  ) INTO v_cutoff_time;

  -- Friday of the current week
  v_this_friday := v_today + (5 - EXTRACT(ISODOW FROM v_today)::INT);

  -- If today is Mon–Fri, check whether we are still before cutoff
  IF EXTRACT(ISODOW FROM v_today) BETWEEN 1 AND 5 THEN
    v_cutoff_ts := (v_this_friday::TEXT || ' ' || v_cutoff_time)::TIMESTAMPTZ
                   AT TIME ZONE 'Asia/Manila';
    IF v_now_ph > v_cutoff_ts THEN
      -- Past cutoff → shift target to the week after next
      v_next_monday := v_next_monday + INTERVAL '7 days';
    END IF;
  END IF;
  -- Weekend: v_next_monday is already the correct coming Monday

  v_next_friday := v_next_monday + INTERVAL '4 days';

  IF NEW.scheduled_for < v_next_monday OR NEW.scheduled_for > v_next_friday THEN
    RAISE EXCEPTION 'Items can only be added for next week (% to %).', v_next_monday, v_next_friday
      USING ERRCODE = 'P0014';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 2. NEW: validate_weekly_order_cutoff()
-- ---------------------------------------------------------------------------
-- Prevents weekly order creation after Friday 5 PM (Manila TZ).

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

  -- The cutoff is the Friday BEFORE week_start (week_start - 3 days) at cutoff_time Manila
  v_cutoff_ts := ((NEW.week_start - INTERVAL '3 days')::TEXT
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

CREATE TRIGGER trg_validate_weekly_order_cutoff
  BEFORE INSERT ON weekly_orders
  FOR EACH ROW
  EXECUTE FUNCTION validate_weekly_order_cutoff();

-- ---------------------------------------------------------------------------
-- 3. NEW: validate_surplus_order_cutoff()
-- ---------------------------------------------------------------------------
-- Prevents surplus/walk-in orders after 8 AM same day.

CREATE OR REPLACE FUNCTION validate_surplus_order_cutoff()
RETURNS TRIGGER AS $$
DECLARE
  v_cutoff    TEXT;
  v_now_ph    TIMESTAMPTZ;
  v_cutoff_ts TIMESTAMPTZ;
  v_today_ph  DATE;
BEGIN
  IF NEW.order_type NOT IN ('surplus', 'walk_in') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(
    (SELECT value #>> '{}' FROM system_settings WHERE key = 'surplus_cutoff_time'),
    '08:00'
  ) INTO v_cutoff;

  v_now_ph    := NOW() AT TIME ZONE 'Asia/Manila';
  v_today_ph  := v_now_ph::DATE;
  v_cutoff_ts := (v_today_ph::TEXT || ' ' || v_cutoff)::TIMESTAMPTZ
                 AT TIME ZONE 'Asia/Manila';

  IF v_now_ph > v_cutoff_ts THEN
    RAISE EXCEPTION 'Surplus ordering is closed. Deadline was % today.',
      v_cutoff USING ERRCODE = 'P0002';
  END IF;

  IF NEW.scheduled_for != v_today_ph THEN
    RAISE EXCEPTION 'Surplus orders can only be placed for today.'
      USING ERRCODE = 'P0003';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_validate_surplus_order_cutoff
  BEFORE INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION validate_surplus_order_cutoff();

-- ---------------------------------------------------------------------------
-- 4. NEW: validate_daily_cancellation() — RPC
-- ---------------------------------------------------------------------------
-- Called by edge function before cancelling a day from a weekly order.

CREATE OR REPLACE FUNCTION validate_daily_cancellation(
  p_order_id  UUID,
  p_parent_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_order      RECORD;
  v_cutoff     TEXT;
  v_cutoff_ts  TIMESTAMPTZ;
  v_now_ph     TIMESTAMPTZ;
BEGIN
  SELECT o.id, o.status, o.scheduled_for, o.total_amount, o.weekly_order_id
  INTO v_order
  FROM orders o
  WHERE o.id = p_order_id
    AND o.parent_id = p_parent_id
    AND o.status NOT IN ('cancelled', 'completed');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or already cancelled/completed.'
      USING ERRCODE = 'P0004';
  END IF;

  SELECT COALESCE(
    (SELECT value #>> '{}' FROM system_settings WHERE key = 'daily_cancel_cutoff_time'),
    '08:00'
  ) INTO v_cutoff;

  v_now_ph    := NOW() AT TIME ZONE 'Asia/Manila';
  v_cutoff_ts := (v_order.scheduled_for::TEXT || ' ' || v_cutoff)::TIMESTAMPTZ
                 AT TIME ZONE 'Asia/Manila';

  IF v_now_ph > v_cutoff_ts THEN
    RAISE EXCEPTION 'Cannot cancel — past the % cancellation deadline for %.',
      v_cutoff, v_order.scheduled_for USING ERRCODE = 'P0005';
  END IF;

  RETURN jsonb_build_object(
    'order_id',       v_order.id,
    'scheduled_for',  v_order.scheduled_for,
    'total_amount',   v_order.total_amount,
    'can_cancel',     TRUE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 5. NEW: transition_weekly_order_status()
-- ---------------------------------------------------------------------------
-- Auto-transitions weekly order to completed/cancelled when all daily orders
-- reach terminal state.

CREATE OR REPLACE FUNCTION transition_weekly_order_status()
RETURNS TRIGGER AS $$
DECLARE
  v_wid        UUID;
  v_total      INT;
  v_completed  INT;
  v_cancelled  INT;
BEGIN
  v_wid := COALESCE(NEW.weekly_order_id, OLD.weekly_order_id);
  IF v_wid IS NULL THEN RETURN NEW; END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'cancelled')
  INTO v_total, v_completed, v_cancelled
  FROM orders
  WHERE weekly_order_id = v_wid;

  -- All days are terminal (completed or cancelled) → close the weekly order
  IF (v_completed + v_cancelled) = v_total AND v_total > 0 THEN
    UPDATE weekly_orders
    SET
      status     = CASE WHEN v_cancelled = v_total THEN 'cancelled' ELSE 'completed' END,
      updated_at = NOW()
    WHERE id = v_wid
      AND status NOT IN ('completed', 'cancelled');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_transition_weekly_order_status
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  WHEN (NEW.weekly_order_id IS NOT NULL)
  EXECUTE FUNCTION transition_weekly_order_status();

-- ---------------------------------------------------------------------------
-- 6. NEW: recalculate_weekly_order_total()
-- ---------------------------------------------------------------------------
-- Recalculates weekly order total_amount when a daily order is cancelled.

CREATE OR REPLACE FUNCTION recalculate_weekly_order_total()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'cancelled'
     AND OLD.status != 'cancelled'
     AND NEW.weekly_order_id IS NOT NULL
  THEN
    UPDATE weekly_orders
    SET
      total_amount = (
        SELECT COALESCE(SUM(total_amount), 0)
        FROM orders
        WHERE weekly_order_id = NEW.weekly_order_id
          AND status != 'cancelled'
      ),
      updated_at = NOW()
    WHERE id = NEW.weekly_order_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_recalculate_weekly_order_total
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status != 'cancelled')
  EXECUTE FUNCTION recalculate_weekly_order_total();

-- ---------------------------------------------------------------------------
-- 7. NEW: get_weekly_order_summary() — RPC
-- ---------------------------------------------------------------------------
-- Kitchen prep aggregation: what to prepare per day per product per meal.

CREATE OR REPLACE FUNCTION get_weekly_order_summary(p_week_start DATE)
RETURNS TABLE (
  scheduled_for   DATE,
  meal_period     TEXT,
  product_id      UUID,
  product_name    TEXT,
  total_quantity  BIGINT,
  order_count     BIGINT,
  grade_breakdown JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.scheduled_for,
    oi.meal_period,
    oi.product_id,
    p.name                      AS product_name,
    SUM(oi.quantity)::BIGINT    AS total_quantity,
    COUNT(DISTINCT o.id)::BIGINT AS order_count,
    jsonb_object_agg(
      COALESCE(s.grade_level, 'unknown'),
      grade_counts.qty
    )                           AS grade_breakdown
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  JOIN products p    ON p.id = oi.product_id
  LEFT JOIN students s ON s.id = o.student_id
  LEFT JOIN LATERAL (
    SELECT SUM(oi2.quantity)::BIGINT AS qty
    FROM orders o2
    JOIN order_items oi2 ON oi2.order_id = o2.id
    JOIN students s2     ON s2.id = o2.student_id
    WHERE o2.scheduled_for  = o.scheduled_for
      AND oi2.product_id    = oi.product_id
      AND oi2.meal_period   = oi.meal_period
      AND s2.grade_level    = s.grade_level
      AND o2.status        != 'cancelled'
      AND oi2.status        = 'confirmed'
  ) grade_counts ON TRUE
  WHERE o.scheduled_for >= p_week_start
    AND o.scheduled_for <  p_week_start + INTERVAL '5 days'
    AND o.status        != 'cancelled'
    AND oi.status        = 'confirmed'
  GROUP BY o.scheduled_for, oi.meal_period, oi.product_id, p.name
  ORDER BY o.scheduled_for, oi.meal_period, p.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 8. NEW: get_weekly_report() — RPC
-- ---------------------------------------------------------------------------
-- Weekly reporting aggregation for admin.

CREATE OR REPLACE FUNCTION get_weekly_report(p_week_start DATE)
RETURNS TABLE (
  total_weekly_orders    BIGINT,
  total_students         BIGINT,
  total_revenue          NUMERIC,
  total_cancelled_days   BIGINT,
  cancelled_revenue      NUMERIC,
  surplus_orders         BIGINT,
  surplus_revenue        NUMERIC,
  daily_breakdown        JSONB,
  payment_method_breakdown JSONB,
  top_products           JSONB
) AS $$
DECLARE
  v_end DATE := p_week_start + INTERVAL '5 days';
BEGIN
  RETURN QUERY SELECT
    (SELECT COUNT(*) FROM weekly_orders
     WHERE week_start = p_week_start AND status != 'cancelled')::BIGINT,

    (SELECT COUNT(DISTINCT student_id) FROM weekly_orders
     WHERE week_start = p_week_start AND status != 'cancelled')::BIGINT,

    (SELECT COALESCE(SUM(total_amount), 0) FROM orders
     WHERE scheduled_for >= p_week_start AND scheduled_for < v_end
       AND status != 'cancelled' AND order_type = 'pre_order')::NUMERIC,

    (SELECT COUNT(*) FROM orders
     WHERE scheduled_for >= p_week_start AND scheduled_for < v_end
       AND status = 'cancelled' AND order_type = 'pre_order')::BIGINT,

    (SELECT COALESCE(SUM(total_amount), 0) FROM orders
     WHERE scheduled_for >= p_week_start AND scheduled_for < v_end
       AND status = 'cancelled' AND order_type = 'pre_order')::NUMERIC,

    (SELECT COUNT(*) FROM orders
     WHERE scheduled_for >= p_week_start AND scheduled_for < v_end
       AND order_type IN ('surplus','walk_in') AND status != 'cancelled')::BIGINT,

    (SELECT COALESCE(SUM(total_amount), 0) FROM orders
     WHERE scheduled_for >= p_week_start AND scheduled_for < v_end
       AND order_type IN ('surplus','walk_in') AND status != 'cancelled')::NUMERIC,

    -- Daily breakdown
    (SELECT jsonb_agg(jsonb_build_object(
        'date', d.day, 'orders', d.cnt, 'revenue', d.rev
     ) ORDER BY d.day)
     FROM (
       SELECT scheduled_for AS day, COUNT(*) AS cnt, SUM(total_amount) AS rev
       FROM orders
       WHERE scheduled_for >= p_week_start AND scheduled_for < v_end
         AND status != 'cancelled'
       GROUP BY scheduled_for
     ) d),

    -- Payment method breakdown
    (SELECT jsonb_agg(jsonb_build_object(
        'method', pm.payment_method, 'count', pm.cnt, 'amount', pm.total
     ))
     FROM (
       SELECT payment_method, COUNT(*) AS cnt, SUM(total_amount) AS total
       FROM orders
       WHERE scheduled_for >= p_week_start AND scheduled_for < v_end
         AND status != 'cancelled'
       GROUP BY payment_method
     ) pm),

    -- Top 10 products
    (SELECT jsonb_agg(jsonb_build_object(
        'product_name', tp.name, 'total_quantity', tp.qty, 'revenue', tp.rev
     ))
     FROM (
       SELECT p.name, SUM(oi.quantity) AS qty,
              SUM(oi.quantity * oi.price_at_order) AS rev
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       WHERE o.scheduled_for >= p_week_start AND o.scheduled_for < v_end
         AND o.status != 'cancelled' AND oi.status = 'confirmed'
       GROUP BY p.name ORDER BY qty DESC LIMIT 10
     ) tp);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 9. NEW: updated_at trigger for weekly_orders
-- ---------------------------------------------------------------------------

CREATE TRIGGER update_weekly_orders_updated_at
  BEFORE UPDATE ON weekly_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 10. DROP redundant trigger on cart_items (replaced by rewritten validate_cart_item_date)
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS validate_cart_item_max_advance_trigger ON cart_items;
