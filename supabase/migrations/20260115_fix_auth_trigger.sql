-- Fix: The sync_user_role trigger was causing auth failures
-- The trigger runs on auth.users INSERT but user_profiles doesn't exist yet
-- Change to use INSERT ... ON CONFLICT or handle missing row gracefully

-- Drop the problematic triggers
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;

-- Create a safer function that handles missing user_profiles row
CREATE OR REPLACE FUNCTION sync_user_role()
RETURNS TRIGGER AS $$
BEGIN
  -- Only update if user_profiles row exists
  -- For new users, the profile will be created by the register/create-user function
  UPDATE user_profiles 
  SET role = COALESCE(NEW.raw_user_meta_data->>'role', role, 'parent')
  WHERE id = NEW.id;
  
  -- Always return NEW to not block the auth operation
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log but don't fail - auth must succeed
    RAISE WARNING 'sync_user_role failed for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger ONLY for updates (not inserts)
-- For inserts, the edge function will handle profile creation with correct role
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.raw_user_meta_data->>'role' IS DISTINCT FROM NEW.raw_user_meta_data->>'role')
  EXECUTE FUNCTION sync_user_role();
