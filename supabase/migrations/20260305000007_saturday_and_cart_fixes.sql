-- Migration: Saturday support for menu_schedules + relax cart_items trigger
-- Fixes:
--   1. day_of_week CHECK constraint: allow 6 (Saturday) for makeup days
--   2. Correct existing Saturday rows that were clamped to day_of_week=5
--   3. Relax validate_cart_item_date() to allow any future school day from next Monday onward
--      (instead of restricting to exactly one week)

-- ═══════════════════════════════════════════════════
-- 1. Widen day_of_week constraint to include Saturday
-- ═══════════════════════════════════════════════════
ALTER TABLE menu_schedules DROP CONSTRAINT IF EXISTS menu_schedules_day_of_week_check;
ALTER TABLE menu_schedules ADD CONSTRAINT menu_schedules_day_of_week_check
  CHECK (day_of_week >= 1 AND day_of_week <= 6);

-- Fix existing Saturday rows that were incorrectly stored as day_of_week=5
UPDATE menu_schedules
SET day_of_week = 6,
    updated_at = NOW()
WHERE EXTRACT(ISODOW FROM scheduled_date) = 6
  AND day_of_week = 5;

-- ═══════════════════════════════════════════════════
-- 2. Relax validate_cart_item_date() trigger
--    Allow any school day from the next orderable Monday onward
--    (removes the single-week ceiling, keeps the floor)
-- ═══════════════════════════════════════════════════
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

  -- Determine the next orderable Monday (earliest date parents may order for)
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

  -- Only enforce the floor: scheduled_for must be >= next orderable Monday
  -- No ceiling: parents can order for any future published week
  IF NEW.scheduled_for < v_next_monday THEN
    RAISE EXCEPTION 'Items can only be added for dates starting from next week (%). Current and past weeks are not allowed.', v_next_monday
      USING ERRCODE = 'P0014';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
