-- Fix moderate issues found in migration analysis
-- 1. Add WITH CHECK to makeup_days UPDATE policy for consistency
-- 2. Add composite index for orders(scheduled_for, status)
-- 3. Add index for recurring holidays lookup

-- ============================================
-- FIX 1: Add WITH CHECK to makeup_days UPDATE policy
-- ============================================

DROP POLICY IF EXISTS "Admins can update makeup days" ON makeup_days;

CREATE POLICY "Admins can update makeup days"
  ON makeup_days FOR UPDATE
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );

-- ============================================
-- FIX 2: Add composite index for future orders queries
-- ============================================

-- Drop old single-column index if exists
DROP INDEX IF EXISTS idx_orders_scheduled_for;

-- Create composite index for common query pattern: scheduled_for + status
CREATE INDEX idx_orders_scheduled_for_status ON orders(scheduled_for, status);

-- ============================================
-- FIX 3: Add index for recurring holidays lookup
-- ============================================

CREATE INDEX IF NOT EXISTS idx_holidays_recurring ON holidays(is_recurring) WHERE is_recurring = TRUE;

-- ============================================
-- FIX 4: Add partial unique index for menu_schedules
-- Prevents duplicate product entries for the same scheduled_date
-- ============================================

-- First drop the existing constraint that allows duplicate NULLs
ALTER TABLE menu_schedules DROP CONSTRAINT IF EXISTS menu_schedules_product_id_scheduled_date_key;

-- Create partial unique index that only applies to non-null dates
CREATE UNIQUE INDEX IF NOT EXISTS menu_schedules_product_date_unique 
ON menu_schedules(product_id, scheduled_date) 
WHERE scheduled_date IS NOT NULL;
