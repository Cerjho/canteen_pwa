import { supabase } from './supabaseClient';

export interface Child {
  id: string;
  student_id: string;
  parent_id?: string;
  first_name: string;
  last_name: string;
  grade_level: string;
  section?: string;
  dietary_restrictions?: string;
}

// Get children linked to a parent
export async function getChildren(parentId: string): Promise<Child[]> {
  // Query through parent_students join table
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
        dietary_restrictions
      )
    `)
    .eq('parent_id', parentId);

  if (error) throw error;
  
  // Flatten the result - students is an object (single record from FK)
  return (data || []).map(item => {
    const student = item.students as unknown as {
      id: string;
      student_id: string;
      first_name: string;
      last_name: string;
      grade_level: string;
      section?: string;
      dietary_restrictions?: string;
    };
    return {
      ...student,
      parent_id: parentId
    };
  });
}

// Search for student by student ID (for display only, actual linking goes through Edge Function)
export async function findStudentById(studentId: string): Promise<Child | null> {
  const { data, error } = await supabase
    .from('students')
    .select('id, student_id, first_name, last_name, grade_level, section')
    .eq('student_id', studentId.toUpperCase().trim())
    .eq('is_active', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw error;
  }
  return data;
}

// Link a student to parent account (via Edge Function for security)
export async function linkStudent(studentId: string): Promise<Child> {
  const { data, error } = await supabase.functions.invoke('link-student', {
    body: { action: 'link', student_id: studentId }
  });

  if (error) {
    throw new Error(error.message || 'Failed to link student');
  }
  
  if (data?.error) {
    throw new Error(data.message || 'Failed to link student');
  }
  
  return data.student;
}

// Unlink a student from parent (via Edge Function for security)
export async function unlinkStudent(childId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('link-student', {
    body: { action: 'unlink', student_id: childId }
  });

  if (error) {
    throw new Error(error.message || 'Failed to unlink student');
  }
  
  if (data?.error) {
    throw new Error(data.message || 'Failed to unlink student');
  }
}

// Update child dietary info (via Edge Function for security)
export async function updateChildDietary(childId: string, dietaryRestrictions: string): Promise<Child> {
  const { data, error } = await supabase.functions.invoke('update-dietary', {
    body: { child_id: childId, dietary_restrictions: dietaryRestrictions }
  });

  if (error) {
    throw new Error(error.message || 'Failed to update dietary info');
  }
  
  if (data?.error) {
    throw new Error(data.message || 'Failed to update dietary info');
  }
  
  return data.child;
}

// Legacy function - no longer used by parents
export async function addChild(_child: Omit<Child, 'id' | 'student_id'>): Promise<Child> {
  throw new Error('Adding children is no longer supported. Please use the link feature with a student ID.');
}

// Legacy function - no longer used by parents  
export async function deleteChild(_id: string): Promise<void> {
  throw new Error('Removing children is no longer supported. Please contact the school admin.');
}

// Legacy updateChild - redirect to updateChildDietary
export async function updateChild(id: string, updates: Partial<Child>): Promise<Child> {
  if (updates.dietary_restrictions !== undefined) {
    return updateChildDietary(id, updates.dietary_restrictions || '');
  }
  throw new Error('Only dietary restrictions can be updated. Contact school admin for other changes.');
}