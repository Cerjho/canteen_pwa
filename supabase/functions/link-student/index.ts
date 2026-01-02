// Link Student Edge Function
// Parent linking with full server-side validation

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LinkStudentRequest {
  action: 'link' | 'unlink';
  student_id: string; // The display student ID (YY-XXXXX format) for link, UUID for unlink
}

// Validate student ID format (YY-XXXXX)
function isValidStudentIdFormat(studentId: string): boolean {
  const pattern = /^\d{2}-\d{5}$/;
  return pattern.test(studentId);
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

    // Initialize Supabase client with service role for operations
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

    // Verify user is a parent
    const userRole = user.user_metadata?.role;
    if (userRole !== 'parent') {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Only parents can link students' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: LinkStudentRequest = await req.json();
    const { action, student_id } = body;

    if (!['link', 'unlink'].includes(action)) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Invalid action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!student_id) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Student ID required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle LINK action
    if (action === 'link') {
      // Normalize student ID input
      const normalizedId = student_id.toUpperCase().trim();

      // Validate student ID format
      if (!isValidStudentIdFormat(normalizedId)) {
        return new Response(
          JSON.stringify({ 
            error: 'VALIDATION_ERROR', 
            message: 'Invalid Student ID format. Expected format: YY-XXXXX (e.g., 26-00001)' 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Find student by student_id
      const { data: student, error: findError } = await supabaseAdmin
        .from('students')
        .select('id, student_id, first_name, last_name, grade_level, section')
        .eq('student_id', normalizedId)
        .eq('is_active', true)
        .single();

      if (findError || !student) {
        console.log(`Student lookup failed for ID: ${normalizedId}`);
        return new Response(
          JSON.stringify({ 
            error: 'NOT_FOUND', 
            message: 'Student ID not found. Please verify the ID with the school admin.' 
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check if already linked to any parent
      const { data: existingLink } = await supabaseAdmin
        .from('parent_students')
        .select('parent_id')
        .eq('student_id', student.id)
        .single();

      if (existingLink) {
        // Check if linked to current user
        if (existingLink.parent_id === user.id) {
          return new Response(
            JSON.stringify({ 
              error: 'ALREADY_LINKED', 
              message: 'This student is already linked to your account.' 
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        // Linked to another parent - security concern, log it
        console.log(`SECURITY: User ${user.id} attempted to link already-linked student ${student.id}`);
        return new Response(
          JSON.stringify({ 
            error: 'ALREADY_LINKED', 
            message: 'This student is already linked to another parent account. Please contact the school admin.' 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check how many children this parent already has linked (rate limiting)
      const { data: existingChildren, error: countError } = await supabaseAdmin
        .from('parent_students')
        .select('id')
        .eq('parent_id', user.id);

      if (!countError && existingChildren && existingChildren.length >= 10) {
        console.log(`LIMIT: User ${user.id} has reached max linked children`);
        return new Response(
          JSON.stringify({ 
            error: 'LIMIT_REACHED', 
            message: 'Maximum number of linked children reached (10). Please contact support.' 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Link the student by inserting into parent_students
      const { error: linkError } = await supabaseAdmin
        .from('parent_students')
        .insert({ 
          parent_id: user.id,
          student_id: student.id,
          relationship: 'parent',
          is_primary: true
        });

      if (linkError) {
        console.error('Failed to link student:', linkError);
        return new Response(
          JSON.stringify({ 
            error: 'SERVER_ERROR', 
            message: 'Failed to link student. The student may have been linked by another user.' 
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get dietary restrictions for response
      const linkedStudent = {
        id: student.id,
        student_id: student.student_id,
        first_name: student.first_name,
        last_name: student.last_name,
        grade_level: student.grade_level,
        section: student.section
      };

      console.log(`SUCCESS: User ${user.id} linked student ${student.id}`);
      return new Response(
        JSON.stringify({ success: true, student: linkedStudent }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle UNLINK action
    if (action === 'unlink') {
      // For unlink, student_id should be the UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(student_id)) {
        return new Response(
          JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Invalid student ID format' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Verify the student link belongs to this parent
      const { data: link, error: findError } = await supabaseAdmin
        .from('parent_students')
        .select('id, parent_id, student_id')
        .eq('student_id', student_id)
        .eq('parent_id', user.id)
        .single();

      if (findError || !link) {
        return new Response(
          JSON.stringify({ error: 'NOT_FOUND', message: 'Student not linked to your account' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Delete the link
      const { error: unlinkError } = await supabaseAdmin
        .from('parent_students')
        .delete()
        .eq('id', link.id);

      if (unlinkError) {
        console.error('Failed to unlink student:', unlinkError);
        return new Response(
          JSON.stringify({ error: 'SERVER_ERROR', message: 'Failed to unlink student' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`SUCCESS: User ${user.id} unlinked student ${student_id}`);
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Link student error:', error);
    return new Response(
      JSON.stringify({ error: 'SERVER_ERROR', message: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
