-- Add role column to user_profiles for proper filtering
-- This allows us to filter parents from staff/admin in queries

ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'parent';

-- Update existing users' roles from auth.users metadata
-- Note: This requires a function to sync roles since we can't directly join auth.users

-- Create a function to sync user role from auth metadata
CREATE OR REPLACE FUNCTION sync_user_role()
RETURNS TRIGGER AS $$
BEGIN
  -- Update user_profiles role when auth user metadata changes
  UPDATE user_profiles 
  SET role = COALESCE(NEW.raw_user_meta_data->>'role', 'parent')
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on auth.users (if not exists)
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_role();

-- Also sync on insert
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_role();

-- Sync existing users' roles (one-time migration)
UPDATE user_profiles up
SET role = COALESCE(
  (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = up.id),
  'parent'
);

-- Delete wallets for non-parent users (staff/admin shouldn't have wallets)
DELETE FROM wallets
WHERE user_id IN (
  SELECT id FROM user_profiles WHERE role IN ('staff', 'admin')
);

-- Add index for role filtering
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);
