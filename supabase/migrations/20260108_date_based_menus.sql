-- Migrate from day-of-week based scheduling to date-based scheduling
-- This allows each day to have its own unique menu

-- ============================================
-- ADD SCHEDULED_DATE COLUMN TO MENU_SCHEDULES
-- ============================================

-- Add the new column
ALTER TABLE menu_schedules 
ADD COLUMN IF NOT EXISTS scheduled_date DATE;

-- Create index for date lookups
CREATE INDEX IF NOT EXISTS idx_menu_schedules_date ON menu_schedules(scheduled_date);

-- Drop the old unique constraint if it exists (product_id, day_of_week)
-- and create a new one for (product_id, scheduled_date)
ALTER TABLE menu_schedules 
DROP CONSTRAINT IF EXISTS menu_schedules_product_id_day_of_week_key;

-- Add new unique constraint for date-based scheduling
ALTER TABLE menu_schedules 
ADD CONSTRAINT menu_schedules_product_id_scheduled_date_key 
UNIQUE (product_id, scheduled_date);

-- Note: We keep day_of_week for backward compatibility but scheduled_date takes priority
-- The app will use scheduled_date if present, otherwise fall back to day_of_week

