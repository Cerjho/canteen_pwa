// Manage Student Edge Function
// Admin-only student management with full server-side validation

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface StudentData {
  first_name: string;
  last_name: string;
  grade_level: string;
  section?: string;
  dietary_restrictions?: string;
}

interface ImportStudent {
  first_name: string;
  last_name: string;
  grade_level: string;
  section?: string;
}

interface ManageStudentRequest {
  action: 'add' | 'update' | 'delete' | 'unlink' | 'import';
  student_id?: string; // For update/delete/unlink
  data?: StudentData; // For add/update
  students?: ImportStudent[]; // For bulk import
}

const VALID_GRADE_LEVELS = [
  'Kindergarten',
  'Grade 1',
  'Grade 2',
  'Grade 3',
  'Grade 4',
  'Grade 5',
  'Grade 6',
];

function sanitizeString(str: string | undefined, maxLength: number = 100): string {
  if (!str) return '';
  return str.trim().slice(0, maxLength).replace(/[<>]/g, '');
}

function validateStudentData(data: StudentData): { valid: boolean; error?: string } {
  if (!data.first_name || data.first_name.trim().length < 1) {
    return { valid: false, error: 'First name is required' };
  }
  if (!data.last_name || data.last_name.trim().length < 1) {
    return { valid: false, error: 'Last name is required' };
  }
  if (!data.grade_level || !VALID_GRADE_LEVELS.includes(data.grade_level)) {
    return { valid: false, error: `Invalid grade level. Must be one of: ${VALID_GRADE_LEVELS.join(', ')}` };
  }
  if (data.first_name.length > 50 || data.last_name.length > 50) {
    return { valid: false, error: 'Name cannot exceed 50 characters' };
  }
  if (data.section && data.section.length > 10) {
    return { valid: false, error: 'Section cannot exceed 10 characters' };
  }
  if (data.dietary_restrictions && data.dietary_restrictions.length > 500) {
    return { valid: false, error: 'Dietary restrictions cannot exceed 500 characters' };
  }
  return { valid: true };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get auth token from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract token from Bearer header
    const token = authHeader.replace('Bearer ', '');

    // Initialize Supabase client with service role for admin operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Get user from token using admin client
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      console.log('Auth error:', authError?.message);
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // CRITICAL: Verify user is an admin - NEVER trust client claim
    const userRole = user.user_metadata?.role;
    if (userRole !== 'admin') {
      console.log(`SECURITY: Non-admin user ${user.id} attempted student management`);
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: ManageStudentRequest = await req.json();
    const { action, student_id, data, students } = body;

    // Validate action
    if (!['add', 'update', 'delete', 'unlink', 'import'].includes(action)) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Invalid action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle ADD action
    if (action === 'add') {
      if (!data) {
        return new Response(
          JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Student data required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const validation = validateStudentData(data);
      if (!validation.valid) {
        return new Response(
          JSON.stringify({ error: 'VALIDATION_ERROR', message: validation.error }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Generate student ID server-side
      const { data: newStudentId, error: idError } = await supabaseAdmin.rpc('generate_student_id');
      if (idError) {
        console.error('Failed to generate student ID:', idError);
        return new Response(
          JSON.stringify({ error: 'SERVER_ERROR', message: 'Failed to generate student ID' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Insert student with sanitized data
      const { data: newStudent, error: insertError } = await supabaseAdmin
        .from('students')
        .insert({
          student_id: newStudentId,
          first_name: sanitizeString(data.first_name, 50),
          last_name: sanitizeString(data.last_name, 50),
          grade_level: data.grade_level, // Already validated
          section: sanitizeString(data.section, 10) || null,
          dietary_restrictions: sanitizeString(data.dietary_restrictions, 500) || null,
          is_active: true,
          created_by: user.id,
        })
        .select()
        .single();

      if (insertError) {
        console.error('Failed to add student:', insertError);
        return new Response(
          JSON.stringify({ error: 'SERVER_ERROR', message: 'Failed to add student' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, student: newStudent }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle UPDATE action
    if (action === 'update') {
      if (!student_id || !data) {
        return new Response(
          JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Student ID and data required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(student_id)) {
        return new Response(
          JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Invalid student ID format' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const validation = validateStudentData(data);
      if (!validation.valid) {
        return new Response(
          JSON.stringify({ error: 'VALIDATION_ERROR', message: validation.error }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Verify student exists
      const { data: existing, error: findError } = await supabaseAdmin
        .from('students')
        .select('id')
        .eq('id', student_id)
        .single();

      if (findError || !existing) {
        return new Response(
          JSON.stringify({ error: 'NOT_FOUND', message: 'Student not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Update with sanitized data (do NOT allow updating student_id)
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('students')
        .update({
          first_name: sanitizeString(data.first_name, 50),
          last_name: sanitizeString(data.last_name, 50),
          grade_level: data.grade_level,
          section: sanitizeString(data.section, 10) || null,
          dietary_restrictions: sanitizeString(data.dietary_restrictions, 500) || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', student_id)
        .select()
        .single();

      if (updateError) {
        console.error('Failed to update student:', updateError);
        return new Response(
          JSON.stringify({ error: 'SERVER_ERROR', message: 'Failed to update student' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, student: updated }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle DELETE action
    if (action === 'delete') {
      if (!student_id) {
        return new Response(
          JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Student ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(student_id)) {
        return new Response(
          JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Invalid student ID format' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check if student has any orders before deleting
      const { data: orders, error: ordersError } = await supabaseAdmin
        .from('orders')
        .select('id')
        .eq('student_id', student_id)
        .limit(1);

      if (ordersError) {
        console.error('Failed to check orders:', ordersError);
        return new Response(
          JSON.stringify({ error: 'SERVER_ERROR', message: 'Failed to check student orders' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (orders && orders.length > 0) {
        return new Response(
          JSON.stringify({ 
            error: 'CONSTRAINT_ERROR', 
            message: 'Cannot delete student with existing orders. Consider unlinking instead.' 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // First delete any parent links
      await supabaseAdmin
        .from('parent_students')
        .delete()
        .eq('student_id', student_id);

      // Then delete the student
      const { error: deleteError } = await supabaseAdmin
        .from('students')
        .delete()
        .eq('id', student_id);

      if (deleteError) {
        console.error('Failed to delete student:', deleteError);
        return new Response(
          JSON.stringify({ error: 'SERVER_ERROR', message: 'Failed to delete student' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle UNLINK action
    if (action === 'unlink') {
      if (!student_id) {
        return new Response(
          JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Student ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(student_id)) {
        return new Response(
          JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Invalid student ID format' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Delete the parent-student link
      const { error: unlinkError } = await supabaseAdmin
        .from('parent_students')
        .delete()
        .eq('student_id', student_id);

      if (unlinkError) {
        console.error('Failed to unlink student:', unlinkError);
        return new Response(
          JSON.stringify({ error: 'SERVER_ERROR', message: 'Failed to unlink student' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get the updated student
      const { data: updated } = await supabaseAdmin
        .from('students')
        .select('*')
        .eq('id', student_id)
        .single();

      return new Response(
        JSON.stringify({ success: true, student: updated }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle IMPORT action
    if (action === 'import') {
      if (!students || !Array.isArray(students) || students.length === 0) {
        return new Response(
          JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Students array required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Limit import size
      if (students.length > 500) {
        return new Response(
          JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Cannot import more than 500 students at once' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const results = {
        success: 0,
        failed: 0,
        errors: [] as string[],
      };

      // Process each student
      for (let i = 0; i < students.length; i++) {
        const student = students[i];
        const rowNum = i + 2; // +2 for header row and 1-based index

        const studentData: StudentData = {
          first_name: student.first_name,
          last_name: student.last_name,
          grade_level: student.grade_level,
          section: student.section,
        };

        const validation = validateStudentData(studentData);
        if (!validation.valid) {
          results.failed++;
          results.errors.push(`Row ${rowNum}: ${validation.error}`);
          continue;
        }

        // Generate student ID
        const { data: newStudentId, error: idError } = await supabaseAdmin.rpc('generate_student_id');
        if (idError) {
          results.failed++;
          results.errors.push(`Row ${rowNum}: Failed to generate student ID`);
          continue;
        }

        // Insert student
        const { error: insertError } = await supabaseAdmin
          .from('students')
          .insert({
            student_id: newStudentId,
            first_name: sanitizeString(student.first_name, 50),
            last_name: sanitizeString(student.last_name, 50),
            grade_level: student.grade_level,
            section: sanitizeString(student.section, 10) || null,
            is_active: true,
            created_by: user.id,
          });

        if (insertError) {
          results.failed++;
          results.errors.push(`Row ${rowNum}: Failed to insert - ${insertError.message}`);
        } else {
          results.success++;
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          imported: results.success, 
          failed: results.failed,
          errors: results.errors.slice(0, 10), // Limit error messages
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Manage student error:', error);
    return new Response(
      JSON.stringify({ error: 'SERVER_ERROR', message: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
