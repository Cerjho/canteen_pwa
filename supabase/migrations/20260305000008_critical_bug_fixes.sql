-- Migration: Critical bug fixes (Phase 1)
-- Fixes:
--   C1: validate_cart_item_date() next_monday formula off-by-one (calculated Tuesday instead of Monday)
--   C4: makeup_days table missing acts_as_day column
--   M14: Weekend cutoff logic undefined in cart trigger (Saturday/Sunday before cutoff treated inconsistently)

-- ═══════════════════════════════════════════════════
-- C4: Add acts_as_day column to makeup_days table
--     Stores which day of the week the makeup day replaces (1=Mon..5=Fri)
-- ═══════════════════════════════════════════════════
ALTER TABLE makeup_days ADD COLUMN IF NOT EXISTS acts_as_day INT;
ALTER TABLE makeup_days ADD CONSTRAINT makeup_days_acts_as_day_check
  CHECK (acts_as_day IS NULL OR (acts_as_day >= 1 AND acts_as_day <= 5));

COMMENT ON COLUMN makeup_days.acts_as_day IS 'ISODOW of the weekday this makeup Saturday replaces (1=Mon..5=Fri)';

-- ═══════════════════════════════════════════════════
-- C1 + M14: Fix validate_cart_item_date() trigger function
--   C1:  Formula was (8 - ISODOW) % 7 + 1, which always adds 1 extra day (Tuesday).
--        Correct formula: (7 - ISODOW) % 7 + 1 → always lands on next Monday.
--   M14: Weekend (Sat/Sun) was falling through the BETWEEN 1 AND 5 check,
--        meaning cutoff was never evaluated. Now handled explicitly.
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION validate_cart_item_date()
RETURNS TRIGGER AS $$
DECLARE
  v_now_ph       TIMESTAMPTZ;
  v_today        DATE;
  v_dow          INT;
  v_today_isodow INT;
  v_cutoff_time  TEXT;
  v_cutoff_ts    TIMESTAMPTZ;
  v_this_friday  DATE;
  v_next_monday  DATE;
BEGIN
  v_now_ph := NOW() AT TIME ZONE 'Asia/Manila';
  v_today  := v_now_ph::DATE;
  v_dow    := EXTRACT(ISODOW FROM NEW.scheduled_for);
  v_today_isodow := EXTRACT(ISODOW FROM v_today)::INT;

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

  -- C1 FIX: Correct next-Monday formula
  -- (7 - ISODOW) % 7 + 1 gives days-until-next-Monday for any day:
  --   Mon(1)→7, Tue(2)→6, Wed(3)→5, Thu(4)→4, Fri(5)→3, Sat(6)→2, Sun(7)→1
  v_next_monday := v_today + ((7 - v_today_isodow) % 7 + 1);

  SELECT COALESCE(
    (SELECT value #>> '{}' FROM system_settings WHERE key = 'weekly_cutoff_time'),
    '17:00'
  ) INTO v_cutoff_time;

  -- Friday of the current week
  v_this_friday := v_today + (5 - v_today_isodow);

  -- M14 FIX: Handle all days including weekends
  IF v_today_isodow BETWEEN 1 AND 5 THEN
    -- Weekday: check Friday cutoff
    v_cutoff_ts := (v_this_friday::TEXT || ' ' || v_cutoff_time)::TIMESTAMPTZ
                   AT TIME ZONE 'Asia/Manila';
    IF v_now_ph > v_cutoff_ts THEN
      v_next_monday := v_next_monday + INTERVAL '7 days';
    END IF;
  ELSE
    -- Saturday (6) or Sunday (7): cutoff already passed, push to week after next
    v_next_monday := v_next_monday + INTERVAL '7 days';
  END IF;

  -- Only enforce the floor: scheduled_for must be >= next orderable Monday
  IF NEW.scheduled_for < v_next_monday THEN
    RAISE EXCEPTION 'Items can only be added for dates starting from next week (%). Current and past weeks are not allowed.', v_next_monday
      USING ERRCODE = 'P0014';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
