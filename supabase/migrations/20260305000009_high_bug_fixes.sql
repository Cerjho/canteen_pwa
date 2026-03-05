-- Migration: High & Medium severity bug fixes (Phase 2 & 3)
-- Fixes:
--   H11: sync_user_role — swallows all exceptions silently, allowing role mismatches
--   M13: is_canteen_open — doesn't account for Saturday makeup days
--   M13: get_menu_for_date — returns nothing for Saturday instead of using acts_as_day

-- ═══════════════════════════════════════════════════
-- H11: sync_user_role — re-raise exceptions instead of swallowing
--      A silent failure here causes auth.users and user_profiles roles to diverge
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION sync_user_role()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE user_profiles
  SET role = COALESCE(NEW.raw_app_meta_data->>'role', role, 'parent')
  WHERE id = NEW.id;
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'sync_user_role FAILED for user %: % (SQLSTATE %)', NEW.id, SQLERRM, SQLSTATE;
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════
-- M13: is_canteen_open — account for Saturday makeup days
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION is_canteen_open(check_date DATE DEFAULT CURRENT_DATE)
RETURNS BOOLEAN AS $$
DECLARE
  day_num INTEGER;
BEGIN
  day_num := EXTRACT(DOW FROM check_date)::INTEGER;
  IF day_num = 0 THEN RETURN FALSE; END IF;
  IF is_holiday(check_date) THEN RETURN FALSE; END IF;
  IF day_num >= 1 AND day_num <= 5 THEN RETURN TRUE; END IF;
  RETURN EXISTS (SELECT 1 FROM makeup_days WHERE date = check_date);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════
-- M13: get_menu_for_date — use acts_as_day for Saturday makeup days
-- ═══════════════════════════════════════════════════
-- DROP first because PostgreSQL disallows changing a function's return type via CREATE OR REPLACE
DROP FUNCTION IF EXISTS get_menu_for_date(DATE);
CREATE OR REPLACE FUNCTION get_menu_for_date(target_date DATE)
RETURNS TABLE (
  product_id UUID,
  product_name TEXT,
  product_description TEXT,
  product_price NUMERIC,
  product_category TEXT,
  product_image_url TEXT,
  product_available BOOLEAN
) AS $$
DECLARE
  day_num INTEGER;
  effective_day INTEGER;
BEGIN
  day_num := EXTRACT(DOW FROM target_date);

  IF day_num = 0 THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM holidays WHERE date = target_date) THEN RETURN; END IF;

  IF day_num = 6 THEN
    SELECT md.acts_as_day INTO effective_day FROM makeup_days md WHERE md.date = target_date;
    IF effective_day IS NULL THEN RETURN; END IF;
  ELSE
    effective_day := day_num;
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.name, p.description, p.price,
    p.category, p.image_url, p.available
  FROM products p
  INNER JOIN menu_schedules ms ON p.id = ms.product_id
  WHERE ms.day_of_week = effective_day
    AND ms.is_active = true
    AND p.available = true
  ORDER BY p.category, p.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
