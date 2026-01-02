-- Migration: Separate students table from parent-student linking
-- This creates a cleaner architecture:
-- - students: Master list of all students (managed by admin)
-- - parent_students: Links parents to students (many-to-many relationship)

-- ============================================
-- STEP 1: Create students table
-- ============================================

CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  grade_level TEXT NOT NULL,
  section TEXT,
  dietary_restrictions TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_students_student_id ON students(student_id);
CREATE INDEX idx_students_grade_level ON students(grade_level);
CREATE INDEX idx_students_is_active ON students(is_active);
CREATE INDEX idx_students_name ON students(last_name, first_name);

-- Trigger for updated_at
CREATE TRIGGER update_students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 2: Create parent_students linking table
-- ============================================

CREATE TABLE parent_students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relationship TEXT DEFAULT 'parent', -- parent, guardian, etc.
  is_primary BOOLEAN DEFAULT TRUE, -- primary contact for this student
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(parent_id, student_id)
);

-- Create indexes
CREATE INDEX idx_parent_students_parent_id ON parent_students(parent_id);
CREATE INDEX idx_parent_students_student_id ON parent_students(student_id);

-- Enable RLS
ALTER TABLE parent_students ENABLE ROW LEVEL SECURITY;

-- RLS Policies for parent_students
CREATE POLICY "Parents can view their own links" ON parent_students
FOR SELECT USING (parent_id = auth.uid());

CREATE POLICY "Parents can link unlinked students" ON parent_students
FOR INSERT WITH CHECK (
  parent_id = auth.uid() AND
  NOT EXISTS (
    SELECT 1 FROM parent_students WHERE student_id = parent_students.student_id
  )
);

CREATE POLICY "Admins can manage all links" ON parent_students
FOR ALL USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
);

CREATE POLICY "Staff can view all links" ON parent_students
FOR SELECT USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') IN ('staff', 'admin')
);

-- ============================================
-- STEP 2b: Now add RLS policies for students (after parent_students exists)
-- ============================================

CREATE POLICY "Admins can manage all students" ON students
FOR ALL USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
);

CREATE POLICY "Staff can view all students" ON students
FOR SELECT USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') IN ('staff', 'admin')
);

CREATE POLICY "Parents can view their linked students" ON students
FOR SELECT USING (
  id IN (SELECT student_id FROM parent_students WHERE parent_id = auth.uid())
);

-- ============================================
-- STEP 3: Migrate data from children table
-- ============================================

-- Insert into students from children
INSERT INTO students (id, student_id, first_name, last_name, grade_level, section, dietary_restrictions, created_by, created_at, updated_at)
SELECT 
  id, 
  COALESCE(student_id, 'STU-' || SUBSTRING(id::text, 1, 8)),
  first_name, 
  last_name, 
  grade_level, 
  section, 
  dietary_restrictions, 
  created_by, 
  created_at, 
  updated_at
FROM children;

-- Insert into parent_students from children where parent_id is set
INSERT INTO parent_students (parent_id, student_id, linked_at)
SELECT parent_id, id, updated_at
FROM children
WHERE parent_id IS NOT NULL;

-- ============================================
-- STEP 4: Update orders table FK
-- ============================================

-- Add new column referencing students
ALTER TABLE orders 
ADD COLUMN student_id UUID REFERENCES students(id) ON DELETE RESTRICT;

-- Copy data from child_id to student_id
UPDATE orders SET student_id = child_id;

-- Drop old FK and column (keep child_id for now for backward compat)
-- We'll rename it later after verifying everything works

-- ============================================
-- STEP 5: Update generate_student_id function
-- ============================================

CREATE OR REPLACE FUNCTION generate_student_id()
RETURNS TEXT AS $$
DECLARE
  new_id TEXT;
  year_part TEXT;
  seq_num INTEGER;
BEGIN
  year_part := TO_CHAR(CURRENT_DATE, 'YY');
  
  -- Get next sequence number for this year
  SELECT COALESCE(MAX(
    CASE 
      WHEN student_id ~ ('^' || year_part || '-[0-9]+$') 
      THEN CAST(SPLIT_PART(student_id, '-', 2) AS INTEGER)
      ELSE 0 
    END
  ), 0) + 1
  INTO seq_num
  FROM students;
  
  new_id := year_part || '-' || LPAD(seq_num::TEXT, 5, '0');
  
  RETURN new_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- STEP 6: Drop old children table FIRST before creating view
-- ============================================

-- First drop all policies on children table
DROP POLICY IF EXISTS "Admins can manage all students" ON children;
DROP POLICY IF EXISTS "Parents can view linked children" ON children;
DROP POLICY IF EXISTS "Parents can update linked children dietary info" ON children;
DROP POLICY IF EXISTS "Parents can link unlinked students" ON children;
DROP POLICY IF EXISTS "Staff can view all students" ON children;

-- Drop old triggers
DROP TRIGGER IF EXISTS update_children_updated_at ON children;

-- Rename old table (keep as backup)
ALTER TABLE children RENAME TO children_backup;

-- ============================================
-- STEP 7: Create helper views
-- ============================================

-- View to get students with their linked parents (for admin)
CREATE OR REPLACE VIEW students_with_parents AS
SELECT 
  s.*,
  ps.parent_id,
  up.first_name as parent_first_name,
  up.last_name as parent_last_name,
  up.email as parent_email,
  up.phone_number as parent_phone
FROM students s
LEFT JOIN parent_students ps ON ps.student_id = s.id
LEFT JOIN user_profiles up ON up.id = ps.parent_id;

-- View to get children for a parent (backward compat)
CREATE OR REPLACE VIEW children AS
SELECT 
  s.id,
  ps.parent_id,
  s.student_id,
  s.first_name,
  s.last_name,
  s.grade_level,
  s.section,
  s.dietary_restrictions,
  s.created_by,
  s.created_at,
  s.updated_at
FROM students s
LEFT JOIN parent_students ps ON ps.student_id = s.id;

COMMENT ON VIEW children IS 'DEPRECATED: Use students and parent_students tables directly. This view exists for backward compatibility.';

-- The view 'children' now replaces the table for backward compatibility
