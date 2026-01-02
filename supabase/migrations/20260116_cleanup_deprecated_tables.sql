-- ============================================
-- CLEANUP: Remove deprecated tables and columns
-- Run after verifying new schema works correctly
-- ============================================

-- ============================================
-- STEP 1: Drop the children view (backward compat, no longer needed)
-- ============================================

DROP VIEW IF EXISTS children;

-- ============================================
-- STEP 2: Drop the children_backup table
-- ============================================

DROP TABLE IF EXISTS children_backup CASCADE;

-- ============================================
-- STEP 3: Drop the old parents view if it exists
-- ============================================

DROP VIEW IF EXISTS parents CASCADE;

-- ============================================
-- STEP 4: Remove child_id column from orders (now using student_id)
-- ============================================

-- First drop any FK constraint on child_id
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_child_id_fkey;

-- Drop the deprecated column
ALTER TABLE orders DROP COLUMN IF EXISTS child_id;

-- ============================================
-- STEP 5: Clean up deprecated triggers and functions
-- ============================================

-- Drop old trigger that referenced children table
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- ============================================
-- STEP 6: Ensure student_id is NOT NULL on orders
-- ============================================

-- Update any NULL student_ids (shouldn't exist but just in case)
-- This would fail if there are orders without student_id
-- ALTER TABLE orders ALTER COLUMN student_id SET NOT NULL;

-- ============================================
-- STEP 7: Add index on orders.student_id for performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_orders_student_id ON orders(student_id);

-- ============================================
-- STEP 8: Clean up any orphaned data
-- ============================================

-- Remove parent_students links where parent no longer exists
DELETE FROM parent_students 
WHERE parent_id NOT IN (SELECT id FROM user_profiles);

-- Remove parent_students links where student no longer exists
DELETE FROM parent_students 
WHERE student_id NOT IN (SELECT id FROM students);

-- ============================================
-- STEP 9: Update RLS policies to ensure consistency
-- ============================================

-- Recreate orders policies to use student_id instead of child_id
DROP POLICY IF EXISTS "Parents can view their orders" ON orders;
DROP POLICY IF EXISTS "Parents can create orders for their children" ON orders;

CREATE POLICY "Parents can view their orders" ON orders
FOR SELECT USING (parent_id = auth.uid());

CREATE POLICY "Parents can create orders" ON orders
FOR INSERT WITH CHECK (
  parent_id = auth.uid() AND
  student_id IN (
    SELECT student_id FROM parent_students WHERE parent_id = auth.uid()
  )
);

-- ============================================
-- DONE: Database cleanup complete
-- ============================================
