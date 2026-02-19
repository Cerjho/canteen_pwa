-- Migration: Secure role storage using app_metadata
-- Moves role from user_metadata (client-writable) to app_metadata (server-only)
-- This prevents users from escalating their own privileges

-- ============================================
-- STEP 1: Migrate existing roles from user_metadata to app_metadata
-- ============================================

UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', COALESCE(raw_user_meta_data->>'role', 'parent'))
WHERE raw_app_meta_data->>'role' IS NULL;

-- ============================================
-- STEP 2: Update helper functions to read from app_metadata
-- ============================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    SELECT COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
      FALSE
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_staff_or_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    SELECT COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'role') IN ('staff', 'admin'),
      FALSE
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- STEP 3: Update sync_user_role trigger to read from app_metadata
-- ============================================

CREATE OR REPLACE FUNCTION sync_user_role()
RETURNS TRIGGER AS $$
BEGIN
  -- Sync role from app_metadata to user_profiles table
  UPDATE user_profiles 
  SET role = COALESCE(NEW.raw_app_meta_data->>'role', role, 'parent')
  WHERE id = NEW.id;
  
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'sync_user_role failed for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger to fire on app_metadata changes
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.raw_app_meta_data->>'role' IS DISTINCT FROM NEW.raw_app_meta_data->>'role')
  EXECUTE FUNCTION sync_user_role();

-- ============================================
-- STEP 4: Update RLS policies that directly reference user_metadata
-- ============================================

-- parent_students policies
DROP POLICY IF EXISTS "Admins can manage all links" ON parent_students;
CREATE POLICY "Admins can manage all links" ON parent_students
FOR ALL USING (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

DROP POLICY IF EXISTS "Staff can view all links" ON parent_students;
CREATE POLICY "Staff can view all links" ON parent_students
FOR SELECT USING (
  (auth.jwt() -> 'app_metadata' ->> 'role') IN ('staff', 'admin')
);

-- students policies
DROP POLICY IF EXISTS "Admins can manage all students" ON students;
CREATE POLICY "Admins can manage all students" ON students
FOR ALL USING (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

DROP POLICY IF EXISTS "Staff can view all students" ON students;
CREATE POLICY "Staff can view all students" ON students
FOR SELECT USING (
  (auth.jwt() -> 'app_metadata' ->> 'role') IN ('staff', 'admin')
);

-- invitations policies
DROP POLICY IF EXISTS "Admins can manage invitations" ON invitations;
CREATE POLICY "Admins can manage invitations" ON invitations
FOR ALL USING (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

-- menu_schedules policies
DROP POLICY IF EXISTS "Admin can manage menu schedules" ON menu_schedules;
CREATE POLICY "Admin can manage menu schedules" ON menu_schedules
FOR ALL
TO authenticated
USING (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

-- Remove role from user_metadata (cleanup, optional but recommended)
-- This prevents confusion about where the role lives
UPDATE auth.users
SET raw_user_meta_data = raw_user_meta_data - 'role'
WHERE raw_user_meta_data ? 'role';
