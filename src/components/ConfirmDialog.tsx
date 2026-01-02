/* eslint-disable react-refresh/only-export-components */
import { AlertTriangle, CheckCircle, XCircle, Info } from 'lucide-react';
import { ReactNode } from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  type?: 'danger' | 'warning' | 'success' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  type = 'warning',
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  const iconConfig = {
    danger: { Icon: XCircle, bg: 'bg-red-100 dark:bg-red-900/30', color: 'text-red-600 dark:text-red-400' },
    warning: { Icon: AlertTriangle, bg: 'bg-yellow-100 dark:bg-yellow-900/30', color: 'text-yellow-600 dark:text-yellow-400' },
    success: { Icon: CheckCircle, bg: 'bg-green-100 dark:bg-green-900/30', color: 'text-green-600 dark:text-green-400' },
    info: { Icon: Info, bg: 'bg-blue-100 dark:bg-blue-900/30', color: 'text-blue-600 dark:text-blue-400' }
  };

  const buttonConfig = {
    danger: 'bg-red-600 hover:bg-red-700',
    warning: 'bg-yellow-600 hover:bg-yellow-700',
    success: 'bg-green-600 hover:bg-green-700',
    info: 'bg-blue-600 hover:bg-blue-700'
  };

  const { Icon, bg, color } = iconConfig[type];

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-50 transition-opacity"
        onClick={onCancel}
      />
      
      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div 
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-sm w-full transform transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6 text-center">
            <div className={`inline-flex p-4 rounded-full ${bg} mb-4`}>
              <Icon size={32} className={color} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">{title}</h3>
            <div className="text-gray-600 dark:text-gray-400 mb-6">{message}</div>
            
            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                className={`flex-1 px-4 py-2.5 text-white rounded-lg font-medium transition-colors ${buttonConfig[type]}`}
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// Hook for easier usage
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';

interface UseConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  type?: 'danger' | 'warning' | 'success' | 'info';
}

export function useConfirm() {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<UseConfirmOptions>({
    title: '',
    message: ''
  });
  // Use ref to store resolve callback to avoid stale closure
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Resolve with false if unmounting while open
      if (resolveRef.current) {
        resolveRef.current(false);
        resolveRef.current = null;
      }
    };
  }, []);

  const confirm = useCallback((opts: UseConfirmOptions): Promise<boolean> => {
    setOptions(opts);
    setIsOpen(true);
    
    return new Promise((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setIsOpen(false);
    if (resolveRef.current) {
      resolveRef.current(true);
      resolveRef.current = null;
    }
  }, []);

  const handleCancel = useCallback(() => {
    setIsOpen(false);
    if (resolveRef.current) {
      resolveRef.current(false);
      resolveRef.current = null;
    }
  }, []);

  // Memoize the dialog element to prevent unnecessary re-renders
  // This is an element, not a component - render it directly in JSX
  const ConfirmDialogElement = useMemo(() => (
    <ConfirmDialog
      isOpen={isOpen}
      title={options.title}
      message={options.message}
      confirmLabel={options.confirmLabel}
      cancelLabel={options.cancelLabel}
      type={options.type}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ), [isOpen, options, handleConfirm, handleCancel]);

  return { confirm, ConfirmDialogElement };
}
