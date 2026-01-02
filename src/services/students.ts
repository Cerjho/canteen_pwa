import { supabase } from './supabaseClient';
import type { Student, Child } from '../types';

// Re-export types for backward compatibility
export type { Student, Child };

// Get students linked to a parent via parent_students join table
export async function getStudents(parentId: string): Promise<Student[]> {
  const { data, error } = await supabase
    .from('parent_students')
    .select(`
      student_id,
      students:student_id (
        id,
        student_id,
        first_name,
        last_name,
        grade_level,
        section,
        dietary_restrictions,
        is_active,
        created_at,
        updated_at
      )
    `)
    .eq('parent_id', parentId);

  if (error) throw error;
  
  // Flatten the result - students is an object (single record from FK)
  return (data || []).map(item => {
    const student = item.students as unknown as Student;
    return student;
  }).filter(student => student?.is_active !== false);
}

// @deprecated Use getStudents instead
export async function getChildren(parentId: string): Promise<Child[]> {
  const students = await getStudents(parentId);
  // Convert to Child format for backward compatibility
  return students.map(student => ({
    id: student.id,
    student_id: student.student_id,
    parent_id: parentId, // Add parent_id for backward compat
    first_name: student.first_name,
    last_name: student.last_name,
    grade_level: student.grade_level,
    section: student.section,
    dietary_restrictions: student.dietary_restrictions,
    created_at: student.created_at,
    updated_at: student.updated_at
  }));
}

// Search for student by student ID (for display only, actual linking goes through Edge Function)
export async function findStudentById(studentId: string): Promise<Student | null> {
  const { data, error } = await supabase
    .from('students')
    .select('id, student_id, first_name, last_name, grade_level, section, dietary_restrictions, is_active, created_at, updated_at')
    .eq('student_id', studentId.toUpperCase().trim())
    .eq('is_active', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw error;
  }
  return data as Student;
}

// Link a student to parent account (via Edge Function for security)
export async function linkStudent(studentId: string): Promise<Student> {
  if (!studentId || typeof studentId !== 'string') {
    throw new Error('Valid student ID is required');
  }

  const { data, error } = await supabase.functions.invoke('link-student', {
    body: { action: 'link', student_id: studentId.trim() }
  });

  if (error) {
    // Handle network/infrastructure errors
    throw new Error(error.message || 'Network error while linking student');
  }
  
  if (data?.error) {
    // Handle application-level errors
    throw new Error(data.message || data.error || 'Failed to link student');
  }

  if (!data?.student) {
    throw new Error('Invalid response: student data missing');
  }
  
  return data.student;
}

// Unlink a student from parent (via Edge Function for security)
export async function unlinkStudent(studentId: string): Promise<void> {
  if (!studentId || typeof studentId !== 'string') {
    throw new Error('Valid student ID is required');
  }

  const { data, error } = await supabase.functions.invoke('link-student', {
    body: { action: 'unlink', student_id: studentId.trim() }
  });

  if (error) {
    // Handle network/infrastructure errors
    throw new Error(error.message || 'Network error while unlinking student');
  }
  
  if (data?.error) {
    // Handle application-level errors
    throw new Error(data.message || data.error || 'Failed to unlink student');
  }
}

// Update student dietary info (via Edge Function for security)
export async function updateStudentDietary(studentId: string, dietaryRestrictions: string): Promise<Student> {
  const { data, error } = await supabase.functions.invoke('update-dietary', {
    body: { student_id: studentId, dietary_restrictions: dietaryRestrictions }
  });

  if (error) {
    throw new Error(error.message || 'Failed to update dietary info');
  }
  
  if (data?.error) {
    throw new Error(data.message || 'Failed to update dietary info');
  }
  
  return data.student;
}

// @deprecated Use updateStudentDietary instead
export async function updateChildDietary(childId: string, dietaryRestrictions: string): Promise<Child> {
  const student = await updateStudentDietary(childId, dietaryRestrictions);
  return {
    id: student.id,
    student_id: student.student_id,
    first_name: student.first_name,
    last_name: student.last_name,
    grade_level: student.grade_level,
    section: student.section,
    dietary_restrictions: student.dietary_restrictions,
    created_at: student.created_at,
    updated_at: student.updated_at
  };
}

// @deprecated - no longer used by parents
export async function addChild(_child: Omit<Child, 'id' | 'student_id'>): Promise<Child> {
  throw new Error('Adding students is no longer supported. Please use the link feature with a student ID.');
}

// @deprecated - no longer used by parents  
export async function deleteChild(_id: string): Promise<void> {
  throw new Error('Removing students is no longer supported. Please contact the school admin.');
}

// @deprecated Use updateStudentDietary instead
export async function updateChild(id: string, updates: Partial<Child>): Promise<Child> {
  if (updates.dietary_restrictions !== undefined) {
    return updateChildDietary(id, updates.dietary_restrictions || '');
  }
  throw new Error('Only dietary restrictions can be updated. Contact school admin for other changes.');
}

// Alias for updateChild - for code that uses Student naming
export const updateStudent = updateChild;