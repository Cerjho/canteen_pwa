-- Migration: Add makeup_days table for Saturday make-up classes
-- Created: 2026-01-09

-- Create makeup_days table
CREATE TABLE IF NOT EXISTS makeup_days (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT 'Make-up Class',
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Add check constraint to ensure only Saturdays
ALTER TABLE makeup_days ADD CONSTRAINT makeup_days_saturday_only 
  CHECK (EXTRACT(DOW FROM date) = 6);

-- Enable RLS
ALTER TABLE makeup_days ENABLE ROW LEVEL SECURITY;

-- Everyone can read makeup days
CREATE POLICY "Anyone can view makeup days"
  ON makeup_days FOR SELECT
  USING (true);

-- Only admins can manage makeup days
CREATE POLICY "Admins can manage makeup days"
  ON makeup_days FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM parents 
      WHERE parents.user_id = auth.uid() 
      AND parents.role = 'admin'
    )
  );

-- Create index for date lookups
CREATE INDEX idx_makeup_days_date ON makeup_days(date);

-- Add comment
COMMENT ON TABLE makeup_days IS 'Stores Saturday make-up class days when canteen should be open';
