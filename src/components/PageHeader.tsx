interface PageHeaderProps {
  title: string;
  subtitle?: string | React.ReactNode;
  action?: React.ReactNode;
}

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">{title}</h1>
        {subtitle && <p className="text-gray-600 dark:text-gray-400 mt-1">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}