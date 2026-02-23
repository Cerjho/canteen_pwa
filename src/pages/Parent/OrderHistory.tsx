import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, isToday, isTomorrow, parseISO } from 'date-fns';
import { Package, Clock, ChefHat, CheckCircle, XCircle, AlertCircle, RefreshCw, CreditCard, Calendar, Timer } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { getOrderHistory } from '../../services/orders';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import type { OrderWithDetails } from '../../types';
import { MEAL_PERIOD_LABELS, MEAL_PERIOD_ICONS } from '../../types';

export default function OrderHistory() {
  const { user } = useAuth();
  
  const { data: orders, isLoading, isError, error, refetch } = useQuery<OrderWithDetails[]>({
    queryKey: ['order-history', user?.id],
    queryFn: () => {
      if (!user) throw new Error('User not authenticated');
      return getOrderHistory(user.id);
    },
    enabled: !!user,
    retry: 2
  });

  const getStatusDetails = (status: string) => {
    switch (status) {
      case 'awaiting_payment':
        return { 
          icon: CreditCard, 
          label: 'Awaiting Payment', 
          color: 'text-purple-700 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30' 
        };
      case 'pending':
        return { 
          icon: Clock, 
          label: 'Pending', 
          color: 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700' 
        };
      case 'preparing':
        return { 
          icon: ChefHat, 
          label: 'Preparing', 
          color: 'text-yellow-700 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/30' 
        };
      case 'ready':
        return { 
          icon: Package, 
          label: 'Ready for Pickup', 
          color: 'text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30' 
        };
      case 'completed':
        return { 
          icon: CheckCircle, 
          label: 'Completed', 
          color: 'text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30' 
        };
      case 'cancelled':
        return { 
          icon: XCircle, 
          label: 'Cancelled', 
          color: 'text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30' 
        };
      default:
        return { 
          icon: Clock, 
          label: status, 
          color: 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700' 
        };
    }
  };

  /**
   * Get payment display text based on payment_status and payment_method
   * Distinguishes between paid, unpaid, and refunded states
   */
  const getPaymentDisplay = (order: OrderWithDetails) => {
    const method = order.payment_method || 'cash';
    const paymentStatus = order.payment_status || 'paid'; // Default for backward compatibility
    
    switch (paymentStatus) {
      case 'paid':
        return { text: `Paid via ${method}`, color: 'text-green-600 dark:text-green-400' };
      case 'awaiting_payment':
        return { text: `Unpaid (${method})`, color: 'text-amber-600 dark:text-amber-400' };
      case 'refunded':
        return { text: `Refunded (${method})`, color: 'text-blue-600 dark:text-blue-400' };
      case 'timeout':
        return { text: 'Payment expired', color: 'text-red-600 dark:text-red-400' };
      case 'failed':
        return { text: 'Payment failed', color: 'text-red-600 dark:text-red-400' };
      default:
        return { text: `${method}`, color: 'text-gray-500 dark:text-gray-400' };
    }
  };

  // Timer tick to keep payment countdown updating every second
  const [, setTimerTick] = useState(0);
  useEffect(() => {
    const hasAwaitingPayment = orders?.some(
      o => o.payment_status === 'awaiting_payment' && o.payment_due_at
    );
    if (!hasAwaitingPayment) return;

    const interval = setInterval(() => setTimerTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [orders]);

  /**
   * Get time remaining until payment expires
   */
  const getPaymentTimeRemaining = (paymentDueAt: string | undefined): string | null => {
    if (!paymentDueAt) return null;
    
    const dueDate = new Date(paymentDueAt);
    const now = new Date();
    const diffMs = dueDate.getTime() - now.getTime();
    
    if (diffMs <= 0) return 'Expired';
    
    const minutes = Math.floor(diffMs / 60000);
    const seconds = Math.floor((diffMs % 60000) / 1000);
    
    if (minutes > 0) {
      return `${minutes}m ${seconds}s remaining`;
    }
    return `${seconds}s remaining`;
  };

  /**
   * Format scheduled_for date with friendly labels
   */
  const formatScheduledDate = (scheduledFor: string | undefined) => {
    if (!scheduledFor) return null;
    
    const date = parseISO(scheduledFor);
    if (isToday(date)) return 'Today';
    if (isTomorrow(date)) return 'Tomorrow';
    return format(date, 'MMM d');
  };

  /**
   * Group orders by student + scheduled_for so that meal-period sub-orders
   * for the same child on the same day appear as one card,
   * matching the Dashboard's grouped display.
   */
  const groupedOrders = useMemo(() => {
    if (!orders || orders.length === 0) return [];

    const mealSort: Record<string, number> = { morning_snack: 0, lunch: 1, afternoon_snack: 2 };

    const groups = new Map<string, {
      studentName: string;
      scheduledFor: string;
      createdAt: string;
      orders: OrderWithDetails[];
      totalAmount: number;
    }>();

    for (const order of orders) {
      const child = order.child || order.student;
      const key = `${child?.id || order.id}_${order.scheduled_for}`;
      if (!groups.has(key)) {
        groups.set(key, {
          studentName: `${child?.first_name || 'Unknown'} ${child?.last_name || 'Student'}`,
          scheduledFor: order.scheduled_for || '',
          createdAt: order.created_at,
          orders: [],
          totalAmount: 0,
        });
      }
      const group = groups.get(key)!;
      group.orders.push(order);
      group.totalAmount += order.total_amount;
    }

    // Sort sub-orders within each group by meal period
    for (const group of groups.values()) {
      group.orders.sort(
        (a, b) => (mealSort[a.meal_period || 'lunch'] ?? 1) - (mealSort[b.meal_period || 'lunch'] ?? 1)
      );
    }

    return Array.from(groups.values());
  }, [orders]);

  /**
   * Derive the overall status for a group of sub-orders.
   * Priority: ready > awaiting_payment > preparing > pending > completed > cancelled
   */
  const getGroupStatus = (subOrders: OrderWithDetails[]) => {
    if (subOrders.some(o => o.status === 'ready')) return 'ready';
    if (subOrders.some(o => o.status === 'awaiting_payment' || o.payment_status === 'awaiting_payment')) return 'awaiting_payment';
    if (subOrders.some(o => o.status === 'preparing')) return 'preparing';
    if (subOrders.some(o => o.status === 'pending')) return 'pending';
    if (subOrders.some(o => o.status === 'completed')) return 'completed';
    return subOrders[0]?.status || 'pending';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen pb-20 bg-gray-50 dark:bg-gray-900">
        <div className="container mx-auto px-4 py-6">
          <PageHeader
            title="Order History"
            subtitle="View your past orders"
          />
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="p-4 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
              <AlertCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Failed to load orders
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-sm">
              {error instanceof Error ? error.message : 'Something went wrong. Please try again.'}
            </p>
            <button
              onClick={() => refetch()}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              <RefreshCw size={18} />
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-6">
        <PageHeader
          title="Order History"
          subtitle="View your past orders"
        />

        {groupedOrders.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No orders yet"
            description="Your order history will appear here after you place your first order."
          />
        ) : (
          <div className="space-y-4">
            {groupedOrders.map((group, groupIdx) => {
              const overallStatus = getGroupStatus(group.orders);
              const status = getStatusDetails(overallStatus);
              const StatusIcon = status.icon;
              const hasManyMeals = group.orders.length > 1;

              // Find the earliest completion time (for completed groups)
              const latestCompletion = group.orders
                .filter(o => o.status === 'completed' && o.completed_at)
                .map(o => o.completed_at!)
                .sort()
                .pop();

              return (
                <div
                  key={`${groupIdx}_${group.scheduledFor}`}
                  className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden"
                >
                  {/* Group Header */}
                  <div className="p-4 border-b border-gray-100 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {format(new Date(group.createdAt), 'MMM d, yyyy • h:mm a')}
                        </p>
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                          For {group.studentName}
                        </h3>
                        {/* Show scheduled pickup for non-completed groups */}
                        {group.scheduledFor && !['completed', 'cancelled'].includes(overallStatus) && (
                          <p className="text-xs text-primary-600 dark:text-primary-400 flex items-center gap-1 mt-1">
                            <Calendar size={12} />
                            Pickup: {formatScheduledDate(group.scheduledFor)}
                          </p>
                        )}
                        {/* Show completion time for completed groups */}
                        {overallStatus === 'completed' && latestCompletion && (
                          <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1 mt-1">
                            <CheckCircle size={12} />
                            Completed {format(new Date(latestCompletion), 'MMM d, h:mm a')}
                          </p>
                        )}
                      </div>
                      <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${status.color}`}>
                        <StatusIcon size={14} />
                        <span className="text-xs font-medium">{status.label}</span>
                      </div>
                    </div>
                  </div>

                  {/* Meal Period Sections */}
                  <div className="p-4">
                    <div className="space-y-3">
                      {group.orders.map((order) => {
                        const mealStatus = getStatusDetails(order.status);
                        const MealStatusIcon = mealStatus.icon;

                        return (
                          <div key={order.id} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                            {/* Meal Header */}
                            <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-700/50">
                              <div className="flex items-center gap-2">
                                {order.meal_period && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
                                    {MEAL_PERIOD_ICONS[order.meal_period]} {MEAL_PERIOD_LABELS[order.meal_period]}
                                  </span>
                                )}
                                {hasManyMeals && (
                                  <span className={`inline-flex items-center gap-1 text-xs ${
                                    (order.payment_status === 'timeout' || order.payment_status === 'failed')
                                      ? 'text-red-500 dark:text-red-400'
                                      : 'text-gray-500 dark:text-gray-400'
                                  }`}>
                                    <MealStatusIcon size={12} />
                                    {mealStatus.label}
                                  </span>
                                )}
                              </div>
                              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                ₱{order.total_amount.toFixed(2)}
                              </span>
                            </div>

                            {/* Notes */}
                            {order.notes && (
                              <div className="mx-3 mt-2 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-2">
                                <p className="text-sm text-yellow-800 dark:text-yellow-300">📝 {order.notes}</p>
                              </div>
                            )}

                            {/* Items */}
                            <div className="px-3 py-2 space-y-1.5">
                              {order.items.map((item) => (
                                <div key={item.id} className="flex items-center gap-3">
                                  {item.product.image_url && (
                                    <img
                                      src={item.product.image_url}
                                      alt={item.product.name}
                                      className="w-8 h-8 rounded-lg object-cover"
                                    />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                      {item.product.name}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                      ₱{item.price_at_order.toFixed(2)} × {item.quantity}
                                    </p>
                                  </div>
                                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                    ₱{(item.price_at_order * item.quantity).toFixed(2)}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Group Footer */}
                  <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900 flex items-center justify-between">
                    <div>
                      <span className="text-sm text-gray-500 dark:text-gray-400">Total</span>
                      <p className="text-lg font-bold text-primary-600 dark:text-primary-400">
                        ₱{group.totalAmount.toFixed(2)}
                      </p>
                    </div>
                    <div className="text-xs text-right space-y-0.5">
                      {/* Show per-order payment info */}
                      {group.orders.map((order) => {
                        const paymentDisplay = getPaymentDisplay(order);
                        return (
                          <div key={order.id} className={`capitalize ${paymentDisplay.color}`}>
                            {hasManyMeals && order.meal_period && (
                              <span className="text-gray-400 mr-1">
                                {MEAL_PERIOD_ICONS[order.meal_period]}
                              </span>
                            )}
                            {paymentDisplay.text}
                            {/* Payment countdown */}
                            {order.payment_status === 'awaiting_payment' && order.payment_due_at && (
                              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 mt-0.5 justify-end">
                                <Timer size={12} />
                                {getPaymentTimeRemaining(order.payment_due_at)}
                              </span>
                            )}
                            {order.payment_status === 'timeout' && (
                              <span className="block text-red-600 dark:text-red-400 mt-0.5">
                                Order auto-cancelled
                              </span>
                            )}
                            {order.payment_status === 'failed' && (
                              <span className="block text-red-600 dark:text-red-400 mt-0.5">
                                Payment failed
                              </span>
                            )}
                            {order.status === 'cancelled' && order.payment_status === 'paid' && (
                              <span className="block text-amber-600 dark:text-amber-400 mt-0.5">
                                Refund pending
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
