import { useState } from 'react';
import { Link2 } from 'lucide-react';

interface LinkStudentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (studentId: string) => void;
  isLoading: boolean;
}

export function LinkStudentModal({ isOpen, onClose, onSubmit, isLoading }: LinkStudentModalProps) {
  const [studentId, setStudentId] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId.trim()) return;
    onSubmit(studentId.trim());
  };

  const handleClose = () => {
    setStudentId('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-gray-900 dark:text-gray-100">
          <Link2 size={24} className="text-primary-600 dark:text-primary-400" />
          Link Your Student
        </h2>

        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Enter the Student ID provided by the school to link your student to your account.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Student ID
            </label>
            <input
              type="text"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value.toUpperCase())}
              placeholder="e.g., 26-00001"
              required
              className="w-full px-3 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-lg text-center bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              autoFocus
            />
          </div>

          <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              💡 <strong>Don't have a Student ID?</strong><br />
              Contact the school administration to get your child's Student ID.
            </p>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 py-2 border border-gray-300 dark:border-gray-600 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !studentId.trim()}
              className="flex-1 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-gray-600"
            >
              {isLoading ? 'Linking...' : 'Link Student'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
