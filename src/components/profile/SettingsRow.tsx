import { ChevronRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface SettingsRowProps {
  /** Lucide icon shown on the left inside a tinted circle */
  icon?: LucideIcon;
  /** Background colour class for the icon circle, e.g. "bg-blue-100 dark:bg-blue-900/30" */
  iconBg?: string;
  /** Icon colour class, e.g. "text-blue-600 dark:text-blue-400" */
  iconColor?: string;
  /** Primary label */
  label: string;
  /** Optional smaller description below the label */
  description?: string;
  /** Right-side value text (e.g. a balance amount or date) */
  value?: ReactNode;
  /** Show a chevron on the right to indicate tappable navigation */
  chevron?: boolean;
  /** Element placed on the far right, e.g. a toggle switch — overrides value + chevron */
  rightElement?: ReactNode;
  /** Click handler. Row gets hover/active states when provided. */
  onClick?: () => void;
  /** Visual variant */
  variant?: 'default' | 'danger';
}

export function SettingsRow({
  icon: Icon,
  iconBg = 'bg-gray-100 dark:bg-gray-700',
  iconColor = 'text-gray-600 dark:text-gray-400',
  label,
  description,
  value,
  chevron = false,
  rightElement,
  onClick,
  variant = 'default',
}: SettingsRowProps) {
  const Wrapper = onClick ? 'button' : 'div';
  const isDanger = variant === 'danger';

  return (
    <Wrapper
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${
        onClick ? 'hover:bg-gray-50 dark:hover:bg-gray-700/60 active:bg-gray-100 dark:active:bg-gray-700' : ''
      }`}
    >
      {/* Icon */}
      {Icon && (
        <div className={`p-2 rounded-full shrink-0 ${iconBg}`}>
          <Icon size={18} className={isDanger ? 'text-red-500 dark:text-red-400' : iconColor} />
        </div>
      )}

      {/* Label + description */}
      <div className="flex-1 min-w-0">
        <p className={`font-medium ${isDanger ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
          {label}
        </p>
        {description && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{description}</p>
        )}
      </div>

      {/* Right side */}
      {rightElement ? (
        rightElement
      ) : (
        <div className="flex items-center gap-2 shrink-0">
          {value && (
            <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">{value}</span>
          )}
          {(chevron || onClick) && !rightElement && (
            <ChevronRight size={18} className="text-gray-400 dark:text-gray-500" />
          )}
        </div>
      )}
    </Wrapper>
  );
}
