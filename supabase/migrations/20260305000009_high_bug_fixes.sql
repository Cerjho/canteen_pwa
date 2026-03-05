-- Migration: High severity bug fixes (Phase 2)
-- Fixes:
--   H11: sync_user_role — swallows all exceptions silently, allowing role mismatches

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
