import { User, Edit2 } from 'lucide-react';

interface ProfileHeaderProps {
  /** Full name */
  name: string;
  /** Email address or subtitle text */
  email: string;
  /** Optional role badge (e.g. "Staff", "Admin") */
  role?: string;
  /** Phone number (shown below email if provided) */
  phone?: string;
  /** Callback when the edit button is tapped */
  onEdit: () => void;
}

/**
 * Shared profile header with avatar (initials), name, email, optional role badge,
 * and an edit pencil icon.
 */
export function ProfileHeader({ name, email, role, phone, onEdit }: ProfileHeaderProps) {
  // Derive initials from name
  const initials = name
    .split(' ')
    .filter(Boolean)
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 mb-5">
      <div className="flex items-center gap-4">
        {/* Avatar */}
        <div className="w-20 h-20 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center shrink-0">
          {initials !== '?' ? (
            <span className="text-2xl font-bold text-primary-600 dark:text-primary-400 select-none">
              {initials}
            </span>
          ) : (
            <User size={36} className="text-primary-600 dark:text-primary-400" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 truncate">{name}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{email}</p>
          {phone && (
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">{phone}</p>
          )}
          {role && (
            <span className="inline-flex items-center gap-1 mt-1.5 px-2.5 py-0.5 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-xs font-semibold rounded-full">
              {role}
            </span>
          )}
        </div>

        {/* Edit button */}
        <button
          onClick={onEdit}
          className="p-2.5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors shrink-0"
          aria-label="Edit profile"
          title="Edit profile"
        >
          <Edit2 size={20} />
        </button>
      </div>
    </div>
  );
}
