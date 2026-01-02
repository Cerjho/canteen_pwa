-- Fix generate_student_id function - lpad requires text, not integer
-- The issue was that LPAD(integer, ...) fails; it needs LPAD(text, ...)

CREATE OR REPLACE FUNCTION generate_student_id()
RETURNS TEXT AS $$
DECLARE
  new_id TEXT;
  year_part TEXT;
  seq_num INTEGER;
  seq_part TEXT;
BEGIN
  year_part := TO_CHAR(CURRENT_DATE, 'YY');
  
  -- Get next sequence number for this year (as integer first)
  SELECT COALESCE(MAX(
    CASE 
      WHEN student_id ~ ('^' || year_part || '-[0-9]+$') 
      THEN CAST(SPLIT_PART(student_id, '-', 2) AS INTEGER)
      ELSE 0 
    END
  ), 0) + 1
  INTO seq_num
  FROM children
  WHERE student_id LIKE year_part || '-%';
  
  -- Pad the integer as text
  seq_part := LPAD(seq_num::TEXT, 5, '0');
  
  new_id := year_part || '-' || seq_part;
  
  RETURN new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
