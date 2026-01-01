-- Migration: Admin-only student management
-- Students are added by admin, parents can only link to existing students

-- Add student_id column for unique student identification
ALTER TABLE children 
ADD COLUMN student_id TEXT UNIQUE;

-- Make parent_id nullable (student exists before parent links)
ALTER TABLE children 
ALTER COLUMN parent_id DROP NOT NULL;

-- Add created_by column to track who added the student
ALTER TABLE children 
ADD COLUMN created_by UUID REFERENCES auth.users(id);

-- Create index for student_id lookups
CREATE INDEX idx_children_student_id ON children(student_id);

-- Update RLS policies for children table
-- Drop existing policies first
DROP POLICY IF EXISTS "Parents can view their own children" ON children;
DROP POLICY IF EXISTS "Parents can insert their own children" ON children;
DROP POLICY IF EXISTS "Parents can update their own children" ON children;
DROP POLICY IF EXISTS "Parents can delete their own children" ON children;

-- Admin can do everything with students
CREATE POLICY "Admins can manage all students" ON children
FOR ALL USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
);

-- Parents can view their linked children
CREATE POLICY "Parents can view linked children" ON children
FOR SELECT USING (
  parent_id = auth.uid()
);

-- Parents can update dietary info for their linked children
CREATE POLICY "Parents can update linked children dietary info" ON children
FOR UPDATE USING (
  parent_id = auth.uid()
) WITH CHECK (
  parent_id = auth.uid()
);

-- Parents can link unlinked students to themselves
CREATE POLICY "Parents can link unlinked students" ON children
FOR UPDATE USING (
  parent_id IS NULL
) WITH CHECK (
  parent_id = auth.uid()
);

-- Staff can view all students for order processing
CREATE POLICY "Staff can view all students" ON children
FOR SELECT USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') IN ('staff', 'admin')
);

-- Generate student IDs for existing students
UPDATE children 
SET student_id = 'STU-' || SUBSTRING(id::text, 1, 8)
WHERE student_id IS NULL;

-- Function to generate unique student ID
CREATE OR REPLACE FUNCTION generate_student_id()
RETURNS TEXT AS $$
DECLARE
  new_id TEXT;
  year_part TEXT;
  seq_part TEXT;
BEGIN
  year_part := TO_CHAR(CURRENT_DATE, 'YY');
  
  -- Get next sequence number for this year
  SELECT LPAD(COALESCE(MAX(
    CASE 
      WHEN student_id ~ ('^' || year_part || '-[0-9]+$') 
      THEN CAST(SPLIT_PART(student_id, '-', 2) AS INTEGER)
      ELSE 0 
    END
  ), 0) + 1, 5, '0')::TEXT
  INTO seq_part
  FROM children
  WHERE student_id LIKE year_part || '-%';
  
  new_id := year_part || '-' || seq_part;
  
  RETURN new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comment for documentation
COMMENT ON COLUMN children.student_id IS 'Unique student ID (e.g., 26-00001) for parent linking';
COMMENT ON COLUMN children.parent_id IS 'Nullable - NULL means student not yet linked to a parent';
COMMENT ON COLUMN children.created_by IS 'Admin who added this student';
