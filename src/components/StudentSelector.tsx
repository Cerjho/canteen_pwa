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
}

export function ChildSelector({
  students,
  children,
  selectedStudentId,
  selectedChildId,
  onSelect
}: ChildSelectorProps) {
  // Support both 'students' and 'children' prop for backward compatibility
  const studentList = students || children || [];
  const selectedId = selectedStudentId ?? selectedChildId ?? null;
  
  return (
    <div className="mb-6">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Order for:
      </label>
      <select
        value={selectedId || ''}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white"
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
        <p className="text-sm text-amber-600 mt-2">
          You haven't linked any students yet. Please link a student profile first.
        </p>
      )}
    </div>
  );
}

// Alias for new code
export const StudentSelector = ChildSelector;