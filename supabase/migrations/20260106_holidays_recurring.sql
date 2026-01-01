-- Add is_recurring column to holidays table for yearly recurring holidays

ALTER TABLE holidays 
ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE;

-- Comment for documentation
COMMENT ON COLUMN holidays.is_recurring IS 'If true, the holiday recurs every year on the same date';
