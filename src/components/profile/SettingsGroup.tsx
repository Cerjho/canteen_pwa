import type { ReactNode } from 'react';

interface SettingsGroupProps {
  /** Optional label displayed above the card */
  title?: string;
  children: ReactNode;
}

/**
 * iOS Settings-style grouped card. Wraps `SettingsRow` children
 * with dividers between them inside a rounded card.
 */
export function SettingsGroup({ title, children }: SettingsGroupProps) {
  return (
    <div className="mb-5">
      {title && (
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5 px-1">
          {title}
        </h3>
      )}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
        {children}
      </div>
    </div>
  );
}
