import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  format,
  parseISO,
  addDays,
  isBefore,
  startOfDay,
} from 'date-fns';
import {
  Clock,
  CheckCircle,
  XCircle,
  ChefHat,
  Package,
  CreditCard,
  AlertTriangle,
  Loader2,
  Ban,
} from 'lucide-react';
import { useWeeklyOrderDetail, useCancelDay } from '../../hooks/useOrders';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useConfirm } from '../../components/ConfirmDialog';
import type { OrderWithDetails, MealPeriod } from '../../types';
import { MEAL_PERIOD_LABELS, MEAL_PERIOD_ICONS, isOnlinePaymentMethod } from '../../types';
import { getPaymentMethodLabel } from '../../services/payments';

/* ================================================================
   HELPERS
   ================================================================ */

const STATUS_META: Record<string, { icon: typeof Clock; label: string; color: string }> = {
  awaiting_payment: {
    icon: CreditCard,
    label: 'Awaiting Payment',
    color: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30',
  },
  pending: {
    icon: Clock,
    label: 'Pending',
    color: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30',
  },
  preparing: {
    icon: ChefHat,
    label: 'Preparing',
    color: 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/30',
  },
  ready: {
    icon: Package,
    label: 'Ready',
    color: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30',
  },
  completed: {
    icon: CheckCircle,
    label: 'Completed',
    color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30',
  },
  cancelled: {
    icon: XCircle,
    label: 'Cancelled',
    color: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30',
  },
};

function getStatusMeta(status: string) {
  return STATUS_META[status] ?? { icon: Clock, label: status, color: 'text-gray-600 bg-gray-100' };
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/* ================================================================
   COMPONENT
   ================================================================ */

export default function WeeklyOrderReview() {
  const { weeklyOrderId } = useParams<{ weeklyOrderId: string }>();
  const navigate = useNavigate();
  const { confirm, ConfirmDialogElement } = useConfirm();

  const { data: weeklyOrder, isLoading, isError } = useWeeklyOrderDetail(weeklyOrderId ?? null);
  const cancelDay = useCancelDay();

  const [cancellingDayId, setCancellingDayId] = useState<string | null>(null);

  // Build calendar grid from week_start (Mon-Sat, 6 days to include makeup Saturdays)
  const calendarDays = useMemo(() => {
    if (!weeklyOrder) return [];
    const monday = parseISO(weeklyOrder.week_start);
    return Array.from({ length: 6 }, (_, i) => {
      const date = addDays(monday, i);
      const dateStr = format(date, 'yyyy-MM-dd');
      const order = weeklyOrder.daily_orders?.find(
        (o) => o.scheduled_for === dateStr,
      );
      return {
        date,
        dateStr,
        dayLabel: WEEKDAY_LABELS[i],
        order: order ?? null,
        isPast: isBefore(startOfDay(date), startOfDay(new Date())),
      };
    });
  }, [weeklyOrder]);

  // Summary stats
  const stats = useMemo(() => {
    if (!weeklyOrder?.daily_orders) return { active: 0, cancelled: 0, total: 0 };
    const active = weeklyOrder.daily_orders.filter((o) => o.status !== 'cancelled').length;
    const cancelled = weeklyOrder.daily_orders.filter((o) => o.status === 'cancelled').length;
    return { active, cancelled, total: weeklyOrder.daily_orders.length };
  }, [weeklyOrder]);

  // Can a day be cancelled?
  const canCancelDay = (order: OrderWithDetails | null) => {
    if (!order) return false;
    if (order.status === 'cancelled' || order.status === 'completed') return false;
    // Don't allow cancelling past orders
    const scheduledFor = order.scheduled_for ?? '';
    const orderDate = parseISO(scheduledFor);
    if (isBefore(startOfDay(orderDate), startOfDay(new Date()))) return false;
    return true;
  };

  const handleCancelDay = async (order: OrderWithDetails) => {
    const dayLabel = format(parseISO(order.scheduled_for ?? ''), 'EEEE, MMM d');
    const confirmed = await confirm({
      title: 'Cancel Day',
      message: `Cancel your order for ${dayLabel}? A refund will be processed for this day.`,
      confirmLabel: 'Cancel Day',
      type: 'danger',
    });
    if (!confirmed) return;

    setCancellingDayId(order.id);
    try {
      await cancelDay.mutateAsync({ orderId: order.id });
    } finally {
      setCancellingDayId(null);
    }
  };

  // ── Loading / Error states ──────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen pb-20 bg-gray-50 dark:bg-gray-900">
        <div className="container mx-auto px-4 py-6">
          <PageHeader
            title="Weekly Order"
            action={
              <button onClick={() => navigate(-1)} className="text-sm text-primary-600 dark:text-primary-400 font-medium">
                ← Back
              </button>
            }
          />
          <div className="flex items-center justify-center py-20">
            <LoadingSpinner size="lg" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !weeklyOrder) {
    return (
      <div className="min-h-screen pb-20 bg-gray-50 dark:bg-gray-900">
        <div className="container mx-auto px-4 py-6">
          <PageHeader
            title="Weekly Order"
            action={
              <button onClick={() => navigate(-1)} className="text-sm text-primary-600 dark:text-primary-400 font-medium">
                ← Back
              </button>
            }
          />
          <EmptyState
            icon={<AlertTriangle size={48} />}
            title="Order Not Found"
            description="This weekly order could not be loaded."
            action={
              <button
                onClick={() => navigate(-1)}
                className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
              >
                Go Back
              </button>
            }
          />
        </div>
      </div>
    );
  }

  const studentName = weeklyOrder.student
    ? `${weeklyOrder.student.first_name} ${weeklyOrder.student.last_name}`
    : 'Student';

  return (
    <div className="min-h-screen pb-20 bg-gray-50 dark:bg-gray-900">
      <PageHeader
        title="Weekly Order"
        subtitle={`Week of ${format(parseISO(weeklyOrder.week_start), 'MMM d, yyyy')}`}
        action={
          <button onClick={() => navigate(-1)} className="text-sm text-primary-600 dark:text-primary-400 font-medium">
            ← Back
          </button>
        }
      />

      <div className="container mx-auto px-4 py-4 space-y-4">
        {/* ── Header card ────────────────────────────── */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                {studentName}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {format(parseISO(weeklyOrder.week_start), 'MMM d')} –{' '}
                {format(addDays(parseISO(weeklyOrder.week_start), 5), 'MMM d, yyyy')}
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-primary-600 dark:text-primary-400">
                ₱{weeklyOrder.total_amount.toFixed(2)}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {getPaymentMethodLabel(weeklyOrder.payment_method)}
              </p>
            </div>
          </div>

          {/* Stats row */}
          <div className="flex gap-3">
            <div className="flex-1 bg-green-50 dark:bg-green-900/20 rounded-xl px-3 py-2 text-center">
              <p className="text-lg font-bold text-green-700 dark:text-green-400">
                {stats.active}
              </p>
              <p className="text-xs text-green-600 dark:text-green-500">Active Days</p>
            </div>
            {stats.cancelled > 0 && (
              <div className="flex-1 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2 text-center">
                <p className="text-lg font-bold text-red-700 dark:text-red-400">
                  {stats.cancelled}
                </p>
                <p className="text-xs text-red-600 dark:text-red-500">Cancelled</p>
              </div>
            )}
            <div className="flex-1 bg-gray-50 dark:bg-gray-700 rounded-xl px-3 py-2 text-center">
              <p className="text-lg font-bold text-gray-700 dark:text-gray-300">
                {stats.total}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Total Days</p>
            </div>
          </div>

          {/* Payment status banner */}
          {weeklyOrder.payment_status === 'awaiting_payment' &&
            isOnlinePaymentMethod(weeklyOrder.payment_method) && (
              <div className="mt-3 flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2">
                <CreditCard size={16} className="text-amber-600 dark:text-amber-400" />
                <span className="text-sm text-amber-700 dark:text-amber-400">
                  Payment pending — complete payment to confirm orders.
                </span>
              </div>
            )}
        </div>

        {/* ── 5-Day Calendar Grid ────────────────────── */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-1">
            Daily Breakdown
          </h3>

          {calendarDays.map(({ date, dateStr, dayLabel, order, isPast }) => {
            const hasOrder = !!order;
            const isCancelled = order?.status === 'cancelled';
            const statusMeta = order ? getStatusMeta(order.status) : null;
            const StatusIcon = statusMeta?.icon ?? Clock;

            return (
              <div
                key={dateStr}
                className={`bg-white dark:bg-gray-800 rounded-2xl border overflow-hidden transition-all ${
                  isCancelled
                    ? 'border-red-200 dark:border-red-800 opacity-60'
                    : isPast
                      ? 'border-gray-200 dark:border-gray-700 opacity-75'
                      : 'border-gray-100 dark:border-gray-700'
                }`}
              >
                {/* Day header */}
                <div
                  className={`flex items-center justify-between px-4 py-3 ${
                    isCancelled
                      ? 'bg-red-50/50 dark:bg-red-900/10'
                      : isPast
                        ? 'bg-gray-50 dark:bg-gray-800'
                        : 'bg-white dark:bg-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center text-xs font-bold ${
                        isCancelled
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                          : isPast
                            ? 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                            : 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                      }`}
                    >
                      <span className="leading-none">{dayLabel}</span>
                      <span className="text-[10px] leading-none mt-0.5">
                        {format(date, 'd')}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium text-sm text-gray-900 dark:text-gray-100">
                        {format(date, 'MMMM d')}
                      </p>
                      {statusMeta && (
                        <span
                          className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${statusMeta.color}`}
                        >
                          <StatusIcon size={12} />
                          {statusMeta.label}
                        </span>
                      )}
                      {!hasOrder && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          No order
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Cancel button */}
                  {hasOrder && canCancelDay(order) && (
                    <button
                      onClick={() => handleCancelDay(order)}
                      disabled={cancellingDayId === order.id}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {cancellingDayId === order.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Ban size={14} />
                      )}
                      Cancel
                    </button>
                  )}
                </div>

                {/* Order items */}
                {hasOrder && !isCancelled && order.items && order.items.length > 0 && (
                  <div className="px-4 pb-3 pt-1 space-y-2">
                    {order.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 py-1"
                      >
                        {item.product?.image_url ? (
                          <img
                            src={item.product.image_url}
                            alt={item.product?.name}
                            className="w-8 h-8 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                            <Package size={14} className="text-gray-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {item.product?.name || 'Product'}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                            <span>×{item.quantity}</span>
                            <span>₱{(item.price_at_order * item.quantity).toFixed(2)}</span>
                            {item.meal_period && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded">
                                {MEAL_PERIOD_ICONS[item.meal_period as MealPeriod]}{' '}
                                {MEAL_PERIOD_LABELS[item.meal_period as MealPeriod]}
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          ₱{(item.price_at_order * item.quantity).toFixed(2)}
                        </p>
                      </div>
                    ))}

                    {/* Day total */}
                    <div className="flex justify-between items-center pt-2 border-t border-gray-100 dark:border-gray-700">
                      <span className="text-xs text-gray-500 dark:text-gray-400">Day Total</span>
                      <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                        ₱{order.total_amount.toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Cancelled overlay info */}
                {isCancelled && (
                  <div className="px-4 pb-3 pt-1 flex items-center gap-2 text-sm text-red-500 dark:text-red-400">
                    <XCircle size={14} />
                    <span>Order cancelled — refund processed</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Notes ──────────────────────────────────── */}
        {weeklyOrder.notes && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
              Notes
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {weeklyOrder.notes}
            </p>
          </div>
        )}
      </div>

      {ConfirmDialogElement}
    </div>
  );
}
