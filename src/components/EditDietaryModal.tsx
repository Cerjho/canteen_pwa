import { useState } from 'react';
import type { Student } from '../services/students';

interface EditDietaryModalProps {
  isOpen: boolean;
  student: Student | null;
  onClose: () => void;
  onSubmit: (data: Partial<Student>) => void;
  isLoading: boolean;
}

export function EditDietaryModal({ isOpen, student, onClose, onSubmit, isLoading }: EditDietaryModalProps) {
  const [dietaryRestrictions, setDietaryRestrictions] = useState(
    student?.dietary_restrictions || ''
  );

  if (!isOpen || !student) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ dietary_restrictions: dietaryRestrictions || undefined });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold mb-2 text-gray-900 dark:text-gray-100">Edit Dietary Info</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          For {student.first_name} {student.last_name}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Dietary Restrictions / Allergies
            </label>
            <textarea
              value={dietaryRestrictions}
              onChange={(e) => setDietaryRestrictions(e.target.value)}
              placeholder="e.g., No peanuts, vegetarian, lactose intolerant"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            This information will be shown to staff when preparing orders.
          </p>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 border border-gray-300 dark:border-gray-600 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-gray-600"
            >
              {isLoading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
