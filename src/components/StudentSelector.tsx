// Generic type for backward compatibility - accepts both Student and Child
type StudentLike = {
  id: string;
  first_name: string;
  last_name: string;
  grade_level: string;
  section?: string;
};

interface ChildSelectorProps {
  // New prop name
  students?: StudentLike[];
  // Legacy prop name - for backward compatibility
  children?: StudentLike[];
  // New prop name
  selectedStudentId?: string | null;
  // Legacy prop name - for backward compatibility  
  selectedChildId?: string | null;
  onSelect: (id: string) => void;
  required?: boolean;
}

export function ChildSelector({
  students,
  children,
  selectedStudentId,
  selectedChildId,
  onSelect,
  required = false
}: ChildSelectorProps) {
  // Support both 'students' and 'children' prop for backward compatibility
  const studentList = students || children || [];
  const selectedId = selectedStudentId ?? selectedChildId ?? null;
  
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    // Only call onSelect with valid non-empty values
    if (value && value.trim() !== '') {
      onSelect(value);
    }
  };
  
  return (
    <div className="mb-6">
      <label htmlFor="student-selector" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        Order for:{required && <span className="text-red-500 dark:text-red-400 ml-1">*</span>}
      </label>
      <select
        id="student-selector"
        value={selectedId || ''}
        onChange={handleChange}
        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        required={required}
        aria-required={required}
      >
        <option value="">Select a student</option>
        {studentList.map((student) => (
          <option key={student.id} value={student.id}>
            {student.first_name} {student.last_name} - {student.grade_level}
            {student.section && ` ${student.section}`}
          </option>
        ))}
      </select>
      {studentList.length === 0 && (
        <p className="text-sm text-amber-600 dark:text-amber-400 mt-2" role="alert">
          You haven't linked any students yet. Please link a student profile first.
        </p>
      )}
    </div>
  );
}

// Alias for new code
export const StudentSelector = ChildSelector;