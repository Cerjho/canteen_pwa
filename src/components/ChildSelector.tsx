interface Child {
  id: string;
  first_name: string;
  last_name: string;
  grade_level: string;
  section?: string;
}

interface ChildSelectorProps {
  children: Child[];
  selectedChildId: string | null;
  onSelect: (childId: string) => void;
}

export function ChildSelector({
  children,
  selectedChildId,
  onSelect
}: ChildSelectorProps) {
  return (
    <div className="mb-6">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Order for:
      </label>
      <select
        value={selectedChildId || ''}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white"
      >
        <option value="">Select a child</option>
        {children.map((child) => (
          <option key={child.id} value={child.id}>
            {child.first_name} {child.last_name} - {child.grade_level}
            {child.section && ` ${child.section}`}
          </option>
        ))}
      </select>
      {children.length === 0 && (
        <p className="text-sm text-amber-600 mt-2">
          You haven't added any children yet. Please add a child profile first.
        </p>
      )}
    </div>
  );
}