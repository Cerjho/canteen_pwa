-- Fix RLS policy for menu_schedules to allow INSERT

-- Drop all existing policies
DROP POLICY IF EXISTS "Admin can manage menu schedules" ON menu_schedules;
DROP POLICY IF EXISTS "Admin can select menu schedules" ON menu_schedules;
DROP POLICY IF EXISTS "Admin can insert menu schedules" ON menu_schedules;
DROP POLICY IF EXISTS "Admin can update menu schedules" ON menu_schedules;
DROP POLICY IF EXISTS "Admin can delete menu schedules" ON menu_schedules;
DROP POLICY IF EXISTS "Anyone can view menu schedules" ON menu_schedules;

-- Create separate policies for different operations
-- Everyone can read menu schedules (for menu filtering)
CREATE POLICY "Anyone can view menu schedules"
  ON menu_schedules FOR SELECT
  TO authenticated, anon
  USING (true);

-- Admin can insert using JWT claim check
CREATE POLICY "Admin can insert menu schedules"
  ON menu_schedules FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );

-- Admin can update using JWT claim check
CREATE POLICY "Admin can update menu schedules"
  ON menu_schedules FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );

-- Admin can delete using JWT claim check
CREATE POLICY "Admin can delete menu schedules"
  ON menu_schedules FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );
