type StudentLike = {
  id: string;
  first_name: string;
  last_name: string;
  grade_level: string;
  section?: string;
};

interface StudentSelectorProps {
  students?: StudentLike[];
  /** @deprecated Use students instead */
  children?: StudentLike[];
  selectedStudentId?: string | null;
  /** @deprecated Use selectedStudentId instead */
  selectedChildId?: string | null;
  onSelect: (id: string) => void;
  required?: boolean;
}

export function StudentSelector({
  students,
  children,
  selectedStudentId,
  selectedChildId,
  onSelect,
  required = false
}: StudentSelectorProps) {
  const studentList = students || children || [];
  const selectedId = selectedStudentId ?? selectedChildId ?? null;
  
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
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
      {studentList.length > 0 && !selectedId && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5" role="alert">
          Select a student to start ordering.
        </p>
      )}
    </div>
  );
}

/** @deprecated Use StudentSelector instead */
export const ChildSelector = StudentSelector;