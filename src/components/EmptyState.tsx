import { LucideIcon } from 'lucide-react';
import { isValidElement, createElement } from 'react';

interface EmptyStateProps {
  icon: React.ReactNode | LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  const renderIcon = () => {
    // Check if it's already a valid React element (like <Package size={48} />)
    if (isValidElement(Icon)) {
      return Icon;
    }
    // Check if it's a component (LucideIcon or function component)
    if (typeof Icon === 'function' || (typeof Icon === 'object' && Icon !== null && '$$typeof' in Icon)) {
      return createElement(Icon as LucideIcon, { size: 48 });
    }
    return Icon;
  };

  return (
    <div className="text-center py-12 px-4">
      <div className="text-gray-400 dark:text-gray-500 mb-4 flex justify-center">{renderIcon()}</div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">{title}</h3>
      <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-sm mx-auto">{description}</p>
      {action && <div>{action}</div>}
    </div>
  );
}