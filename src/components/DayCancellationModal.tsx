import { useState, useMemo } from 'react';
import { X, AlertTriangle, Calendar, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { isDailyCancelCutoffPassed } from '../utils/dateUtils';
import type { OrderWithDetails } from '../types';

interface DayCancellationModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Daily orders within the weekly order */
  dailyOrders: OrderWithDetails[];
  /** Called when user confirms cancellation of selected order IDs */
  onConfirmCancel: (orderIds: string[]) => Promise<void>;
  /** e.g. '08:00' — daily cancel cutoff time */
  cancelCutoffTime?: string;
}

export function DayCancellationModal({
  isOpen,
  onClose,
  dailyOrders,
  onConfirmCancel,
  cancelCutoffTime = '08:00',
}: DayCancellationModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cutoffH, cutoffM] = cancelCutoffTime.split(':').map(Number);

  // Determine which orders are eligible for cancellation
  const ordersWithStatus = useMemo(
    () =>
      dailyOrders
        .filter((o) => o.status !== 'cancelled' && o.status !== 'completed')
        .map((order) => {
          const pastCutoff = isDailyCancelCutoffPassed(
            order.scheduled_for ?? '',
            cutoffH,
            cutoffM,
          );
          return { order, canCancel: !pastCutoff };
        })
        .sort((a, b) => (a.order.scheduled_for ?? '').localeCompare(b.order.scheduled_for ?? '')),
    [dailyOrders, cutoffH, cutoffM],
  );

  const refundTotal = useMemo(() => {
    return ordersWithStatus
      .filter((o) => selectedIds.has(o.order.id))
      .reduce((sum, o) => sum + o.order.total_amount, 0);
  }, [ordersWithStatus, selectedIds]);

  const toggleOrder = (orderId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selectedIds.size === 0) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onConfirmCancel(Array.from(selectedIds));
      setSelectedIds(new Set());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancellation failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Cancel Days
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            Select the day(s) you want to cancel. Cancellations must be made
            before {cancelCutoffTime.replace(/^0/, '')} AM of each day.
          </p>

          {ordersWithStatus.length === 0 && (
            <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-4">
              No active orders to cancel.
            </p>
          )}

          {ordersWithStatus.map(({ order, canCancel }) => {
            const isSelected = selectedIds.has(order.id);
            const dayLabel = order.scheduled_for ? format(parseISO(order.scheduled_for), 'EEEE, MMM d') : 'Unknown';
            const itemCount = order.items?.length ?? 0;

            return (
              <button
                key={order.id}
                type="button"
                onClick={() => canCancel && toggleOrder(order.id)}
                disabled={!canCancel}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                  !canCancel
                    ? 'border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 opacity-50 cursor-not-allowed'
                    : isSelected
                      ? 'border-red-400 bg-red-50 dark:bg-red-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                {/* Checkbox */}
                <div
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    isSelected
                      ? 'bg-red-500 border-red-500'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}
                >
                  {isSelected && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 6L5 9L10 3"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>

                {/* Day info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Calendar size={14} className="text-gray-400" />
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {dayLabel}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {itemCount} item{itemCount !== 1 ? 's' : ''} · ₱
                    {order.total_amount.toFixed(2)}
                  </p>
                  {!canCancel && (
                    <p className="flex items-center gap-1 text-xs text-red-500 dark:text-red-400 mt-0.5">
                      <Clock size={10} />
                      Past cancellation cutoff
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 text-center">
              {error}
            </p>
          )}

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20">
              <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Refund of <span className="font-semibold">₱{refundTotal.toFixed(2)}</span> will
                be processed to your original payment method.
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Keep All
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={selectedIds.size === 0 || isSubmitting}
              className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium transition-colors"
            >
              {isSubmitting
                ? 'Cancelling...'
                : `Cancel ${selectedIds.size} Day${selectedIds.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
