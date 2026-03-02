/* eslint-disable react-refresh/only-export-components */
import { AlertTriangle, CheckCircle, XCircle, Info } from 'lucide-react';
import { ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

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
  const dialogRef = useRef<HTMLDivElement>(null);

  // Handle Escape key to dismiss dialog
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  // Auto-focus and trap focus within dialog
  useEffect(() => {
    if (!isOpen || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const buttons = dialog.querySelectorAll<HTMLButtonElement>('button');
    if (buttons.length > 0) buttons[0].focus();

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = dialog.querySelectorAll<HTMLElement>('button, [tabindex]');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [isOpen]);

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

  return createPortal(
    <>
      {/* Backdrop — pointer-events:auto overrides Radix Dialog modal's body pointer-events:none */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] animate-fade-in" style={{ pointerEvents: 'auto' }} />
      
      {/* Dialog wrapper — click outside panel dismisses */}
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
        style={{ pointerEvents: 'auto' }}
        onClick={onCancel}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-sm w-full animate-slide-up"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6 text-center">
            <div className={`inline-flex p-4 rounded-full ${bg} mb-4`}>
              <Icon size={32} className={color} />
            </div>
            <h3 id="confirm-dialog-title" className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">{title}</h3>
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
    </>,
    document.body
  );
}

// Hook for easier usage
import { useState, useCallback, useMemo } from 'react';

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
    // Resolve any pending promise before replacing
    if (resolveRef.current) {
      resolveRef.current(false);
      resolveRef.current = null;
    }
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
  ), [isOpen, options.title, options.message, options.confirmLabel, options.cancelLabel, options.type, handleConfirm, handleCancel]);

  return { confirm, ConfirmDialogElement };
}
