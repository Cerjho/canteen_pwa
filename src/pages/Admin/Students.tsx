import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Search, 
  Plus, 
  Upload, 
  Download, 
  Trash2, 
  Edit2, 
  X, 
  UserCheck, 
  UserX,
  GraduationCap,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle
} from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { friendlyError } from '../../utils/friendlyError';

interface Student {
  id: string;
  student_id: string;
  first_name: string;
  last_name: string;
  grade_level: string;
  section?: string;
  dietary_restrictions?: string;
  is_active?: boolean;
  parent?: {
    first_name: string;
    last_name: string;
    email: string;
  };
  created_at: string;
}

const GRADE_LEVELS = [
  'Kindergarten',
  'Grade 1',
  'Grade 2',
  'Grade 3',
  'Grade 4',
  'Grade 5',
  'Grade 6',
];

export default function AdminStudents() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterGrade, setFilterGrade] = useState<string>('all');
  const [filterLinked, setFilterLinked] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);

  // Fetch all students
  const { data: students, isLoading } = useQuery<Student[]>({
    queryKey: ['admin-students'],
    queryFn: async () => {
      // Query students with linked parents
      const { data, error } = await supabase
        .from('students')
        .select(`
          *,
          parent_students(
            parent:user_profiles(id, first_name, last_name, email)
          )
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      
      // Transform to expected format (flatten parent from join)
      return data?.map(s => ({
        ...s,
        parent: s.parent_students?.[0]?.parent || null
      })) || [];
    }
  });

  // Add student mutation (via Edge Function)
  const addStudent = useMutation({
    mutationFn: async (student: Omit<Student, 'id' | 'student_id' | 'created_at' | 'parent'>) => {
      const { data, error } = await supabase.functions.invoke('manage-student', {
        body: { action: 'add', data: student }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.message);
      return data.student;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-students'] });
      setShowAddModal(false);
      showToast('Student added successfully', 'success');
    },
    onError: (err: Error) => showToast(friendlyError(err.message, 'add student'), 'error')
  });

  // Update student mutation (via Edge Function)
  const updateStudent = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Student> }) => {
      const { data: result, error } = await supabase.functions.invoke('manage-student', {
        body: { action: 'update', student_id: id, data }
      });
      if (error) throw error;
      if (result?.error) throw new Error(result.message);
      return result.student;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-students'] });
      setEditingStudent(null);
      showToast('Student updated successfully', 'success');
    },
    onError: (err: Error) => showToast(friendlyError(err.message, 'update student'), 'error')
  });

  // Delete student mutation (via Edge Function)
  const deleteStudent = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('manage-student', {
        body: { action: 'delete', student_id: id }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-students'] });
      showToast('Student deleted successfully', 'success');
    },
    onError: (err: Error) => showToast(friendlyError(err.message, 'delete student'), 'error')
  });

  // Unlink student from parent (via Edge Function)
  const unlinkStudent = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('manage-student', {
        body: { action: 'unlink', student_id: id }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-students'] });
      showToast('Student unlinked from parent', 'success');
    },
    onError: (err: Error) => showToast(friendlyError(err.message, 'unlink student'), 'error')
  });

  // Filter students
  const filteredStudents = students?.filter(student => {
    // Search filter
    if (searchQuery) {
      const search = searchQuery.toLowerCase();
      const matchesSearch = 
        student.first_name.toLowerCase().includes(search) ||
        student.last_name.toLowerCase().includes(search) ||
        student.student_id?.toLowerCase().includes(search) ||
        student.parent?.email?.toLowerCase().includes(search);
      if (!matchesSearch) return false;
    }
    
    // Grade filter
    if (filterGrade !== 'all' && student.grade_level !== filterGrade) return false;
    
    // Linked status filter
    if (filterLinked === 'linked' && !student.parent) return false;
    if (filterLinked === 'unlinked' && student.parent) return false;
    
    return true;
  });

  // Stats
  const totalStudents = students?.length || 0;
  const linkedStudents = students?.filter(s => s.parent).length || 0;
  const unlinkedStudents = totalStudents - linkedStudents;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-20">
      <div className="container mx-auto px-4 py-6">
        <PageHeader title="Students" />

        <div className="space-y-4 mt-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-1">
              <GraduationCap size={16} />
              <span className="text-xs">Total</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{totalStudents}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-500 mb-1">
              <UserCheck size={16} />
              <span className="text-xs">Linked</span>
            </div>
            <p className="text-2xl font-bold text-green-600 dark:text-green-500">{linkedStudents}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-500 mb-1">
              <UserX size={16} />
              <span className="text-xs">Unlinked</span>
            </div>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-500">{unlinkedStudents}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex-1 flex items-center justify-center gap-2 bg-primary-600 text-white py-3 rounded-xl font-medium hover:bg-primary-700"
          >
            <Plus size={20} />
            Add Student
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center justify-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-4 py-3 rounded-xl font-medium hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Upload size={20} />
            Import
          </button>
        </div>

        {/* Search & Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 shadow-sm space-y-3">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder="Search by name, ID, or parent email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={filterGrade}
              onChange={(e) => setFilterGrade(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
            >
              <option value="all">All Grades</option>
              {GRADE_LEVELS.map(grade => (
                <option key={grade} value={grade}>{grade}</option>
              ))}
            </select>
            <select
              value={filterLinked}
              onChange={(e) => setFilterLinked(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
            >
              <option value="all">All Status</option>
              <option value="linked">Linked</option>
              <option value="unlinked">Unlinked</option>
            </select>
          </div>
        </div>

        {/* Students List */}
        <div className="space-y-3">
          {filteredStudents?.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-8 text-center">
              <GraduationCap size={48} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-gray-500 dark:text-gray-400">No students found</p>
            </div>
          ) : (
            filteredStudents?.map(student => (
              <div
                key={student.id}
                className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                        {student.first_name} {student.last_name}
                      </h3>
                      {student.parent ? (
                        <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs rounded-full flex items-center gap-1">
                          <UserCheck size={12} />
                          Linked
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs rounded-full flex items-center gap-1">
                          <UserX size={12} />
                          Unlinked
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      <span className="font-mono bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-xs mr-2">
                        {student.student_id}
                      </span>
                      {student.grade_level}
                      {student.section && ` - ${student.section}`}
                    </p>
                    {student.parent && (
                      <p className="text-xs text-primary-600 mt-1">
                        Parent: {student.parent.first_name} {student.parent.last_name} ({student.parent.email})
                      </p>
                    )}
                    {student.dietary_restrictions && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        ⚠️ {student.dietary_restrictions}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditingStudent(student)}
                      className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                    >
                      <Edit2 size={16} className="text-gray-600 dark:text-gray-400" />
                    </button>
                    {student.parent && (
                      <button
                        onClick={() => {
                          if (confirm('Unlink this student from their parent?')) {
                            unlinkStudent.mutate(student.id);
                          }
                        }}
                        className="p-2 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-lg"
                        title="Unlink from parent"
                      >
                        <UserX size={16} className="text-amber-600 dark:text-amber-400" />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (confirm('Delete this student? This cannot be undone.')) {
                          deleteStudent.mutate(student.id);
                        }
                      }}
                      className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg"
                    >
                      <Trash2 size={16} className="text-red-500 dark:text-red-400" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      </div>

      {/* Add Student Modal */}
      {showAddModal && (
        <StudentModal
          onClose={() => setShowAddModal(false)}
          onSubmit={(data) => addStudent.mutate(data)}
          isLoading={addStudent.isPending}
        />
      )}

      {/* Edit Student Modal */}
      {editingStudent && (
        <StudentModal
          student={editingStudent}
          onClose={() => setEditingStudent(null)}
          onSubmit={(data) => updateStudent.mutate({ id: editingStudent.id, data })}
          isLoading={updateStudent.isPending}
        />
      )}

      {/* Import Modal */}
      {showImportModal && (
        <ImportModal
          onClose={() => setShowImportModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['admin-students'] });
            setShowImportModal(false);
          }}
        />
      )}
    </div>
  );
}
// Student form data type
interface StudentFormData {
  first_name: string;
  last_name: string;
  grade_level: string;
  section?: string;
  dietary_restrictions?: string;
}

// Student Add/Edit Modal
function StudentModal({
  student,
  onClose,
  onSubmit,
  isLoading
}: {
  student?: Student;
  onClose: () => void;
  onSubmit: (data: StudentFormData) => void;
  isLoading: boolean;
}) {
  const [firstName, setFirstName] = useState(student?.first_name || '');
  const [lastName, setLastName] = useState(student?.last_name || '');
  const [gradeLevel, setGradeLevel] = useState(student?.grade_level || '');
  const [section, setSection] = useState(student?.section || '');
  const [dietaryRestrictions, setDietaryRestrictions] = useState(student?.dietary_restrictions || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      first_name: firstName,
      last_name: lastName,
      grade_level: gradeLevel,
      section: section || undefined,
      dietary_restrictions: dietaryRestrictions || undefined
    });
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full">
          <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {student ? 'Edit Student' : 'Add Student'}
            </h2>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-400">
              <X size={20} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  First Name *
                </label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Last Name *
                </label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Grade Level *
                </label>
                <select
                  value={gradeLevel}
                  onChange={(e) => setGradeLevel(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select grade</option>
                  {GRADE_LEVELS.map(grade => (
                    <option key={grade} value={grade}>{grade}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Section
                </label>
                <input
                  type="text"
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  placeholder="e.g., A, B, Rose"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Dietary Restrictions / Allergies
              </label>
              <textarea
                value={dietaryRestrictions}
                onChange={(e) => setDietaryRestrictions(e.target.value)}
                placeholder="e.g., No peanuts, vegetarian"
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
            </div>

            {student && (
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Student ID: <span className="font-mono font-medium text-gray-900 dark:text-gray-100">{student.student_id}</span>
                </p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2 border border-gray-300 dark:border-gray-600 rounded-lg font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex-1 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:bg-gray-300"
              >
                {isLoading ? 'Saving...' : student ? 'Save Changes' : 'Add Student'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

// Import Modal with CSV support
function ImportModal({
  onClose,
  onSuccess
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const { showToast } = useToast();

  const downloadTemplate = () => {
    const template = 'first_name,last_name,grade_level,section,dietary_restrictions\nJohn,Doe,Grade 1,A,None\nJane,Smith,Grade 2,B,No peanuts';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'students_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setResults(null);

    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      
      // Validate headers
      const requiredHeaders = ['first_name', 'last_name', 'grade_level'];
      const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
      if (missingHeaders.length > 0) {
        throw new Error(`Missing required columns: ${missingHeaders.join(', ')}`);
      }

      // Parse all rows into student objects
      const students = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h] = values[idx] || '';
        });

        if (row.first_name && row.last_name && row.grade_level) {
          students.push({
            first_name: row.first_name,
            last_name: row.last_name,
            grade_level: row.grade_level,
            section: row.section || undefined,
          });
        }
      }

      if (students.length === 0) {
        throw new Error('No valid students found in CSV');
      }

      // Send to Edge Function for server-side validation and import
      const { data, error } = await supabase.functions.invoke('manage-student', {
        body: { action: 'import', students }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.message);

      setResults({ 
        success: data.imported || 0, 
        failed: data.failed || 0, 
        errors: data.errors || [] 
      });
      
      if (data.imported > 0) {
        queryClient.invalidateQueries({ queryKey: ['admin-students'] });
        showToast(`Imported ${data.imported} students`, 'success');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import';
      showToast(message, 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full">
          <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <FileSpreadsheet size={20} />
              Import Students
            </h2>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-400">
              <X size={20} />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {!results ? (
              <>
                <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <h3 className="font-medium text-blue-800 dark:text-blue-300 mb-2">CSV Format</h3>
                  <p className="text-sm text-blue-700 dark:text-blue-400 mb-3">
                    Upload a CSV file with the following columns:
                  </p>
                  <div className="bg-white dark:bg-gray-700 rounded p-2 font-mono text-xs text-gray-600 dark:text-gray-300">
                    first_name, last_name, grade_level, section, dietary_restrictions
                  </div>
                  <button
                    onClick={downloadTemplate}
                    className="mt-3 text-sm text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <Download size={14} />
                    Download template
                  </button>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                  className="w-full flex items-center justify-center gap-2 bg-primary-600 text-white py-3 rounded-xl font-medium hover:bg-primary-700 disabled:bg-gray-300"
                >
                  {importing ? (
                    <>
                      <LoadingSpinner size="sm" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload size={20} />
                      Select CSV File
                    </>
                  )}
                </button>
              </>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4 text-center">
                      <CheckCircle size={24} className="mx-auto text-green-600 dark:text-green-400 mb-1" />
                      <p className="text-2xl font-bold text-green-600 dark:text-green-400">{results.success}</p>
                      <p className="text-sm text-green-700 dark:text-green-500">Imported</p>
                    </div>
                    {results.failed > 0 && (
                      <div className="flex-1 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 text-center">
                        <AlertCircle size={24} className="mx-auto text-red-600 dark:text-red-400 mb-1" />
                        <p className="text-2xl font-bold text-red-600 dark:text-red-400">{results.failed}</p>
                        <p className="text-sm text-red-700 dark:text-red-500">Failed</p>
                      </div>
                    )}
                  </div>

                  {results.errors.length > 0 && (
                    <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 max-h-40 overflow-y-auto">
                      <p className="text-sm font-medium text-red-800 dark:text-red-300 mb-2">Errors:</p>
                      {results.errors.map((err, i) => (
                        <p key={i} className="text-xs text-red-600 dark:text-red-400">{err}</p>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  onClick={onSuccess}
                  className="w-full py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700"
                >
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
