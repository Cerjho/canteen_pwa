/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { CheckCircle, XCircle, AlertCircle, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Track timeout IDs for cleanup
  const timeoutIds = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Cleanup all timeouts on unmount
  useEffect(() => {
    const currentTimeouts = timeoutIds.current;
    return () => {
      currentTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
      currentTimeouts.clear();
    };
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);

    // Auto-dismiss after 4 seconds
    const timeoutId = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timeoutIds.current.delete(id);
    }, 4000);
    
    timeoutIds.current.set(id, timeoutId);
  }, []);

  const dismissToast = useCallback((id: string) => {
    // Clear the timeout when manually dismissed
    const timeoutId = timeoutIds.current.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutIds.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const getIcon = (type: ToastType) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="text-green-500 dark:text-green-400" size={20} />;
      case 'error':
        return <XCircle className="text-red-500 dark:text-red-400" size={20} />;
      default:
        return <AlertCircle className="text-blue-500 dark:text-blue-400" size={20} />;
    }
  };

  const getBgColor = (type: ToastType) => {
    switch (type) {
      case 'success':
        return 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-700';
      case 'error':
        return 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700';
      default:
        return 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700';
    }
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      
      {/* Toast container with ARIA live region for accessibility */}
      <div 
        className="fixed top-4 right-4 z-50 space-y-2"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg animate-slide-in backdrop-blur-sm max-w-sm ${getBgColor(toast.type)}`}
            role="alert"
          >
            {getIcon(toast.type)}
            <span className="text-gray-800 dark:text-gray-200 font-medium">{toast.message}</span>
            <button
              onClick={() => dismissToast(toast.id)}
              className="ml-2 p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
              aria-label="Dismiss notification"
            >
              <X size={16} className="text-gray-600 dark:text-gray-400" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
