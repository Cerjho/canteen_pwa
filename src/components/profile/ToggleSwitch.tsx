import type { ReactNode } from 'react';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
  label?: string;
}

/**
 * Reusable iOS-style toggle switch used inside SettingsRow `rightElement`.
 */
export function ToggleSwitch({ checked, onChange, label }: ToggleSwitchProps): ReactNode {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
        checked ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
          checked ? 'translate-x-5' : ''
        }`}
      />
    </button>
  );
}
