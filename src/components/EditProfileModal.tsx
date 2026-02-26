import { useState, useEffect } from 'react';
import { User } from 'lucide-react';

interface EditProfileModalProps {
  isOpen: boolean;
  profile: {
    first_name: string;
    last_name: string;
    phone_number: string;
  };
  onClose: () => void;
  onSave: (data: { first_name: string; last_name: string; phone_number: string }) => void;
  isLoading: boolean;
}

/**
 * Modal for editing name and phone number. Used by all three profile pages.
 */
export function EditProfileModal({ isOpen, profile, onClose, onSave, isLoading }: EditProfileModalProps) {
  const [formData, setFormData] = useState(profile);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset form when modal opens with new profile data
  useEffect(() => {
    if (isOpen) {
      setFormData(profile);
      setErrors({});
    }
  }, [isOpen, profile]);

  if (!isOpen) return null;

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.first_name.trim()) newErrors.first_name = 'First name is required';
    if (!formData.last_name.trim()) newErrors.last_name = 'Last name is required';

    // Basic PH phone format validation (optional field)
    if (formData.phone_number.trim()) {
      const cleaned = formData.phone_number.replace(/[\s-]/g, '');
      if (!/^(09\d{9}|\+639\d{9})$/.test(cleaned)) {
        newErrors.phone_number = 'Enter a valid PH mobile number (e.g. 09XX XXX XXXX)';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    onSave({
      first_name: formData.first_name.trim(),
      last_name: formData.last_name.trim(),
      phone_number: formData.phone_number.trim(),
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-primary-100 dark:bg-primary-900/30 rounded-full">
            <User size={22} className="text-primary-600 dark:text-primary-400" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Edit Profile</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* First name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              First Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.first_name}
              onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
              className={`w-full px-3 py-2.5 border rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 ${
                errors.first_name ? 'border-red-400 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'
              }`}
              autoFocus
            />
            {errors.first_name && (
              <p className="text-xs text-red-500 mt-1">{errors.first_name}</p>
            )}
          </div>

          {/* Last name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Last Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.last_name}
              onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
              className={`w-full px-3 py-2.5 border rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 ${
                errors.last_name ? 'border-red-400 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'
              }`}
            />
            {errors.last_name && (
              <p className="text-xs text-red-500 mt-1">{errors.last_name}</p>
            )}
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Phone Number
            </label>
            <input
              type="tel"
              value={formData.phone_number}
              onChange={(e) => setFormData(prev => ({ ...prev, phone_number: e.target.value }))}
              placeholder="e.g., 09XX XXX XXXX"
              className={`w-full px-3 py-2.5 border rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 ${
                errors.phone_number ? 'border-red-400 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'
              }`}
            />
            {errors.phone_number && (
              <p className="text-xs text-red-500 mt-1">{errors.phone_number}</p>
            )}
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 py-2.5 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-gray-600"
            >
              {isLoading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
