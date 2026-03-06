import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, addDays } from 'date-fns';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../services/supabaseClient';
import { ensureValidAccessToken } from '../../services/authSession';
import { useAuth } from '../../hooks/useAuth';
import { useOrderSubscription } from '../../hooks/useOrderSubscription';
import { useCart } from '../../hooks/useCart';
import { useWeeklyOrders } from '../../hooks/useOrders';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { PullToRefresh } from '../../components/PullToRefresh';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DayCancellationModal } from '../../components/DayCancellationModal';
import { useToast } from '../../components/Toast';
import type { MealPeriod } from '../../types';
import { MEAL_PERIOD_LABELS, MEAL_PERIOD_ICONS, isOnlinePaymentMethod } from '../../types';
import { friendlyError } from '../../utils/friendlyError';
import { useSystemSettings } from '../../hooks/useSystemSettings';
import { 
  Package, 
  Clock, 
  ChefHat, 
  RefreshCw, 
  Bell, 
  CalendarDays,
  X, 
  RotateCcw, 
  MapPin, 
  Sparkles,
  Timer,
  XCircle,
  ChevronRight
} from 'lucide-react';

// Helper to format date in Philippine timezone (UTC+8)
function formatDateLocal(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

interface OrderItem {
  id: string;
  product_id: string;
  quantity: number;
  price_at_order: number;
  meal_period?: MealPeriod;
  status?: string;
  product: {
    name: string;
    image_url: string;
  };
}

interface Order {
  id: string;
  status: string;
  payment_method?: string;
  payment_status?: string;
  payment_due_at?: string;
  total_amount: number;
  created_at: string;
  scheduled_for: string;
  meal_period?: MealPeriod;
  notes?: string;
  student: {
    id: string;
    first_name: string;
    last_name: string;
  };
  items: OrderItem[];
}

// Get payment time remaining
function getPaymentTimeRemaining(paymentDueAt?: string): { minutes: number; seconds: number; expired: boolean; text: string } {
  if (!paymentDueAt) {
    return { minutes: 0, seconds: 0, expired: true, text: 'No deadline set' };
  }
  
  const dueDate = new Date(paymentDueAt);
  const now = new Date();
  const diffMs = dueDate.getTime() - now.getTime();
  
  if (diffMs <= 0) {
    return { minutes: 0, seconds: 0, expired: true, text: 'Payment expired' };
  }
  
  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);
  
  return { 
    minutes, 
    seconds, 
    expired: false, 
    text: `${minutes}:${seconds.toString().padStart(2, '0')} remaining`
  };
}

export default function ParentDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { addItem } = useCart();
  const [activeTab, setActiveTab] = useState<'today' | 'weekly'>('today');
  const [showCancelDialog, setShowCancelDialog] = useState<string | null>(null);
  const [showDayCancelModal, setShowDayCancelModal] = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState(false);
  const [, setTimerTick] = useState(0); // Force re-render for countdown timers
  
  // Subscribe to realtime order updates
  useOrderSubscription();
  const { settings } = useSystemSettings();
  
  const todayStr = formatDateLocal(new Date());
  
  // Fetch today's active orders (awaiting_payment, pending, preparing, ready)
  // Also include recently timed out orders so parents can see what happened
  const { data: todayOrders, isLoading: loadingToday, refetch: refetchToday } = useQuery<Order[]>({
    queryKey: ['active-orders', user?.id, todayStr],
    queryFn: async () => {
      if (!user) throw new Error('Please sign in to continue.');
      
      // Fetch active orders
      const { data: activeOrders, error: activeError } = await supabase
        .from('orders')
        .select(`
          *,
          student:students!orders_student_id_fkey(id, first_name, last_name),
          items:order_items(
            *,
            product:products(name, image_url)
          )
        `)
        .eq('parent_id', user.id)
        .eq('scheduled_for', todayStr)
        .in('status', ['awaiting_payment', 'pending', 'preparing', 'ready'])
        .order('created_at', { ascending: false });
      
      if (activeError) throw activeError;
      
      // Also fetch recently timed-out orders (last 1 hour) so parents can see them
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: timedOutOrders, error: timeoutError } = await supabase
        .from('orders')
        .select(`
          *,
          student:students!orders_student_id_fkey(id, first_name, last_name),
          items:order_items(
            *,
            product:products(name, image_url)
          )
        `)
        .eq('parent_id', user.id)
        .eq('scheduled_for', todayStr)
        .eq('status', 'cancelled')
        .in('payment_status', ['timeout', 'failed'])
        .gte('updated_at', oneHourAgo)
        .order('created_at', { ascending: false });
      
      if (timeoutError) {
        console.warn('Error fetching timed out orders:', timeoutError);
      }
      
      // Combine and deduplicate
      const allOrders = [...(activeOrders || []), ...(timedOutOrders || [])];
      return allOrders;
    },
    enabled: !!user,
    refetchInterval: 10000 // More frequent refresh to update countdown timers
  });

  // Weekly orders (aggregated weekly pre-orders)
  const { data: weeklyOrders, isLoading: loadingWeekly } = useWeeklyOrders();

  // Future daily orders derived from weekly orders — used for the Cancel Multiple Days modal
  const futureDailyOrders = useMemo(() => {
    if (!weeklyOrders) return [];
    return weeklyOrders
      .flatMap(wo => wo.daily_orders || [])
      .filter(o => (o.scheduled_for ?? '') > todayStr);
  }, [weeklyOrders, todayStr]);

  // Cancel order mutation (via edge function)
  const cancelOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const accessToken = await ensureValidAccessToken();

      const response = await fetch(`${SUPABASE_URL}/functions/v1/parent-cancel-order`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ order_id: orderId }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Failed to cancel order');
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['active-orders'] });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      showToast(result.message || 'Order cancelled successfully', 'success');
      setShowCancelDialog(null);
    },
    onError: (error: Error) => {
      showToast(friendlyError(error.message, 'cancel this order'), 'error');
    }
  });

  // Reorder functionality - fetches current prices and checks availability
  const handleReorder = async (order: Order) => {
    if (!order.student) {
      showToast('Cannot reorder — student info is missing', 'error');
      return;
    }
    const studentName = `${order.student.first_name} ${order.student.last_name}`;
    
    // Fetch current prices and availability for the products
    const productIds = order.items.map(i => i.product_id);
    const { data: currentProducts } = await supabase
      .from('products')
      .select('id, price, available')
      .in('id', productIds);
    
    const productMap = new Map((currentProducts || []).map(p => [p.id, p]));
    let hasPriceChange = false;
    let skippedCount = 0;

    order.items.forEach(item => {
      const product = productMap.get(item.product_id);
      // Skip unavailable products
      if (!product || !product.available) {
        skippedCount++;
        return;
      }
      const currentPrice = product.price as number;
      if (currentPrice !== item.price_at_order) {
        hasPriceChange = true;
      }
      addItem({
        product_id: item.product_id,
        name: item.product.name,
        price: currentPrice,
        image_url: item.product.image_url,
        quantity: item.quantity,
        student_id: order.student.id,
        student_name: studentName,
        scheduled_for: order.scheduled_for,
        meal_period: order.meal_period || 'lunch'
      });
    });

    if (skippedCount === order.items.length) {
      showToast('All items from this order are currently unavailable', 'error');
      return;
    }

    const messages: string[] = [];
    if (skippedCount > 0) messages.push(`${skippedCount} item(s) unavailable`);
    if (hasPriceChange) messages.push('some prices changed');
    
    showToast(
      messages.length > 0
        ? `Items added to cart — ${messages.join(', ')}`
        : 'Items added to cart!',
      messages.length > 0 ? 'info' : 'success'
    );
    navigate('/menu');
  };

  const handleCancelOrder = (orderId: string) => {
    setCancellingOrder(true);
    cancelOrderMutation.mutate(orderId, {
      onSettled: () => setCancellingOrder(false)
    });
  };

  const handleRefresh = async () => {
    await refetchToday();
  };
  
  // Real-time countdown timer for payment deadlines
  useEffect(() => {
    // Check if there are any awaiting_payment orders
    const allOrders = todayOrders || [];
    const hasAwaitingPayment = allOrders.some(o => 
      (o.status === 'awaiting_payment' || o.payment_status === 'awaiting_payment') && o.payment_due_at
    );
    
    if (!hasAwaitingPayment) return;
    
    // Update every second for real-time countdown
    const interval = setInterval(() => {
      setTimerTick(t => t + 1);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [todayOrders]);

  const getStatusDetails = (status: string, paymentStatus?: string, paymentMethod?: string) => {
    // Check for timeout first
    if (paymentStatus === 'timeout' || paymentStatus === 'failed') {
      return {
        icon: XCircle,
        label: paymentStatus === 'timeout' ? 'Timed Out' : 'Payment Failed',
        color: 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
        message: paymentStatus === 'timeout' ? 'Payment expired - Order cancelled' : 'Payment failed - Order cancelled',
        progress: 0
      };
    }
    
    // Check for awaiting payment
    if (status === 'awaiting_payment' || paymentStatus === 'awaiting_payment') {
      const isOnline = paymentMethod ? isOnlinePaymentMethod(paymentMethod) : false;
      return {
        icon: Timer,
        label: 'Awaiting Payment',
        color: 'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800',
        message: isOnline ? 'Verifying payment...' : 'Pay at the counter',
        progress: 10
      };
    }
    
    switch (status) {
      case 'pending':
        return { 
          icon: Clock, 
          label: 'Pending', 
          color: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600',
          message: 'Waiting for kitchen',
          progress: 25
        };
      case 'preparing':
        return { 
          icon: ChefHat, 
          label: 'Preparing', 
          color: 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800',
          message: 'Being prepared now',
          progress: 60
        };
      case 'ready':
        return { 
          icon: Bell, 
          label: 'Ready!', 
          color: 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
          message: 'Ready for pickup',
          progress: 100
        };
      default:
        return { 
          icon: Clock, 
          label: status, 
          color: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600',
          message: '',
          progress: 0
        };
    }
  };

  const isLoading = activeTab === 'today' ? loadingToday : loadingWeekly;
  const orders = activeTab === 'today' ? todayOrders : undefined;

  // Group orders by student + date for merged card display
  const groupedOrders = useMemo(() => {
    if (!orders) return [];
    const mealSort: Record<string, number> = { morning_snack: 0, lunch: 1, afternoon_snack: 2 };
    const groups = new Map<string, {
      studentId: string;
      studentName: string;
      scheduledFor: string;
      createdAt: string;
      orders: Order[];
      totalAmount: number;
    }>();

    for (const order of orders) {
      const key = `${order.student?.id || order.id}_${order.scheduled_for}`;
      if (!groups.has(key)) {
        groups.set(key, {
          studentId: order.student?.id || '',
          studentName: `${order.student?.first_name || 'Unknown'} ${order.student?.last_name || 'Student'}`,
          scheduledFor: order.scheduled_for,
          createdAt: order.created_at,
          orders: [],
          totalAmount: 0,
        });
      }
      const group = groups.get(key);
      if (group) {
        group.orders.push(order);
        group.totalAmount += order.total_amount;
      }
    }

    // Sort orders within each group by meal period
    for (const group of groups.values()) {
      group.orders.sort((a, b) =>
        (mealSort[a.meal_period || 'lunch'] ?? 1) - (mealSort[b.meal_period || 'lunch'] ?? 1)
      );
    }

    return Array.from(groups.values());
  }, [orders]);

  return (
    <div className="min-h-screen pb-20 bg-gray-50 dark:bg-gray-900">
      <PullToRefresh onRefresh={handleRefresh} className="min-h-screen">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-4">
            <PageHeader
              title="My Orders"
              subtitle="Track your orders"
            />
            <button
              onClick={handleRefresh}
              className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full"
            >
              <RefreshCw size={20} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setActiveTab('today')}
              className={`flex-1 py-2.5 rounded-xl font-medium transition-all flex items-center justify-center gap-1.5 text-sm ${
                activeTab === 'today'
                  ? 'bg-primary-600 text-white shadow-md shadow-primary-200 dark:shadow-primary-900/30'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750'
              }`}
            >
              <Bell size={16} />
              Today
              {todayOrders && todayOrders.length > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                  activeTab === 'today' ? 'bg-primary-500' : 'bg-gray-100 dark:bg-gray-700'
                }`}>
                  {todayOrders.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('weekly')}
              className={`flex-1 py-2.5 rounded-xl font-medium transition-all flex items-center justify-center gap-1.5 text-sm ${
                activeTab === 'weekly'
                  ? 'bg-primary-600 text-white shadow-md shadow-primary-200 dark:shadow-primary-900/30'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750'
              }`}
            >
              <CalendarDays size={16} />
              Weekly
              {weeklyOrders && weeklyOrders.length > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                  activeTab === 'weekly' ? 'bg-primary-500' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                }`}>
                  {weeklyOrders.length}
                </span>
              )}
            </button>
          </div>

          {/* Bulk Cancel Days button — shown on Weekly tab when there are cancellable future days */}
          {activeTab === 'weekly' && futureDailyOrders.length > 0 && (
            <button
              onClick={() => setShowDayCancelModal(true)}
              className="mb-4 w-full py-2.5 flex items-center justify-center gap-2 border-2 border-dashed border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-xl text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <X size={16} />
              Cancel Multiple Days
            </button>
          )}

          {isLoading ? (
            <LoadingSpinner size="lg" />
          ) : activeTab === 'weekly' ? (
            /* ── Weekly Orders List ────────────────────── */
            weeklyOrders && weeklyOrders.length > 0 ? (
              <div className="space-y-3">
                {weeklyOrders.map((wo) => {
                  const studentName = wo.student
                    ? `${wo.student.first_name} ${wo.student.last_name}`
                    : 'Student';
                  const activeDays = wo.daily_orders?.filter(o => o.status !== 'cancelled').length ?? 0;
                  const totalDays = wo.daily_orders?.length ?? 0;
                  const weekEnd = format(addDays(parseISO(wo.week_start), 5), 'MMM d');
                  const weekStart = format(parseISO(wo.week_start), 'MMM d');

                  return (
                    <button
                      key={wo.id}
                      onClick={() => navigate(`/order-review/${wo.id}`)}
                      className="w-full bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 text-left hover:shadow-md transition-all active:scale-[0.98]"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                            <CalendarDays size={20} className="text-blue-600 dark:text-blue-400" />
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                              {weekStart} – {weekEnd}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {studentName} · {activeDays}/{totalDays} days active
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-primary-600 dark:text-primary-400">
                            ₱{wo.total_amount.toFixed(2)}
                          </span>
                          <ChevronRight size={16} className="text-gray-400" />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={CalendarDays}
                title="No weekly orders"
                description="Your weekly pre-orders will appear here after checkout"
                action={
                  <Link 
                    to="/menu" 
                    className="inline-flex items-center gap-2 bg-primary-600 text-white px-6 py-2.5 rounded-lg hover:bg-primary-700 font-medium"
                  >
                    Place Weekly Order
                  </Link>
                }
              />
            )
          ) : groupedOrders.length > 0 ? (
            <div className="space-y-4">
              {groupedOrders.map((group) => {
                // Overall card status based on most actionable sub-order
                const hasReadyOrder = group.orders.some(o => o.status === 'ready');
                const hasAwaitingPayment = group.orders.some(o =>
                  o.status === 'awaiting_payment' || o.payment_status === 'awaiting_payment'
                );
                const hasTimedOut = group.orders.some(o => o.payment_status === 'timeout' || o.payment_status === 'failed');
                const hasPreparing = group.orders.some(o => o.status === 'preparing');

                const primaryStatus = hasReadyOrder ? 'ready'
                  : hasAwaitingPayment ? 'awaiting_payment'
                  : hasPreparing ? 'preparing'
                  : 'pending';

                const awaitingPaymentOrder = group.orders.find(o =>
                  o.status === 'awaiting_payment' || o.payment_status === 'awaiting_payment'
                );

                const overallStatus = getStatusDetails(primaryStatus, undefined, awaitingPaymentOrder?.payment_method);
                const OverallIcon = overallStatus.icon;

                return (
                  <div
                    key={`${group.studentId}_${group.scheduledFor}`}
                    className={`bg-white dark:bg-gray-800 rounded-2xl shadow-sm border-2 overflow-hidden transition-all animate-fade-in ${overallStatus.color} ${hasReadyOrder ? 'animate-pulse-subtle ring-2 ring-green-400 shadow-green-100 dark:shadow-green-900/20' : ''}`}
                  >
                    {/* Progress Bar */}
                    <div className="h-1 bg-gray-100 dark:bg-gray-700">
                      <div
                        className={`h-full transition-all duration-500 ${
                          primaryStatus === 'pending' ? 'bg-gray-400' :
                          primaryStatus === 'preparing' ? 'bg-yellow-400' : 'bg-green-500'
                        }`}
                        style={{ width: `${overallStatus.progress}%` }}
                      />
                    </div>

                    {/* Status Banner */}
                    <div className={`px-4 py-3 flex items-center justify-between ${overallStatus.color}`}>
                      <div className="flex items-center gap-2">
                        <OverallIcon size={20} className={hasReadyOrder ? 'animate-bounce' : ''} />
                        <span className="font-semibold">{overallStatus.label}</span>
                      </div>
                      <span className="text-sm">{overallStatus.message}</span>
                    </div>

                    {/* Ready Banner */}
                    {hasReadyOrder && (
                      <div className="bg-green-500 text-white px-4 py-2.5 flex items-center justify-center gap-2 font-medium">
                        <Sparkles size={16} className="animate-bounce-gentle" />
                        <span>Order ready for pickup!</span>
                        <Sparkles size={16} className="animate-bounce-gentle" />
                      </div>
                    )}

                    {/* Payment Countdown Banner */}
                    {hasAwaitingPayment && awaitingPaymentOrder && (
                      <div className="bg-orange-500 text-white px-4 py-2 flex items-center justify-center gap-2">
                        <Timer size={16} className="animate-pulse" />
                        <span className="font-medium">
                          {awaitingPaymentOrder.payment_method && isOnlinePaymentMethod(awaitingPaymentOrder.payment_method)
                            ? `Verifying payment: ${getPaymentTimeRemaining(awaitingPaymentOrder.payment_due_at).text}`
                            : `Pay at counter: ${getPaymentTimeRemaining(awaitingPaymentOrder.payment_due_at).text}`
                          }
                        </span>
                      </div>
                    )}

                    {/* Timeout Banner */}
                    {hasTimedOut && (
                      <div className="bg-red-500 text-white px-4 py-2 flex items-center justify-center gap-2">
                        <XCircle size={16} />
                        <span className="font-medium">Payment expired - Order cancelled</span>
                      </div>
                    )}

                    <div className="p-4">
                      {/* Student Header */}
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100">
                            For {group.studentName}
                          </h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {`Ordered at ${format(new Date(group.createdAt), 'h:mm a')}`}
                          </p>
                        </div>
                        <span className="text-xl font-bold text-primary-600 dark:text-primary-400">
                          ₱{group.totalAmount.toFixed(2)}
                        </span>
                      </div>

                      {/* Meal Period Sections */}
                      <div className="space-y-3">
                        {group.orders.map((order) => {
                          const mealStatus = getStatusDetails(order.status, order.payment_status, order.payment_method);
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
                                  {group.orders.length > 1 && (
                                    <span className={`inline-flex items-center gap-1 text-xs ${
                                      (order.payment_status === 'timeout' || order.payment_status === 'failed') ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'
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
                                  <div key={item.id} className={`flex items-center gap-3 ${
                                    item.status === 'unavailable' ? 'opacity-50' : ''
                                  }`}>
                                    {item.product.image_url && (
                                      <img
                                        src={item.product.image_url}
                                        alt={item.product.name}
                                        className="w-8 h-8 rounded-lg object-cover"
                                      />
                                    )}
                                    <div className="flex-1">
                                      <p className={`font-medium text-sm text-gray-900 dark:text-gray-100 ${
                                        item.status === 'unavailable' ? 'line-through' : ''
                                      }`}>
                                        {item.product.name}
                                        {item.meal_period && (
                                          <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded ml-1">
                                            {MEAL_PERIOD_ICONS[item.meal_period]} {MEAL_PERIOD_LABELS[item.meal_period]}
                                          </span>
                                        )}
                                      </p>
                                      {item.status === 'unavailable' && (
                                        <p className="text-xs text-red-500">Unavailable — refunded</p>
                                      )}
                                    </div>
                                    <span className={`text-sm ${
                                      item.status === 'unavailable'
                                        ? 'text-gray-400 line-through'
                                        : 'text-gray-600 dark:text-gray-400'
                                    }`}>×{item.quantity}</span>
                                  </div>
                                ))}
                              </div>

                              {/* Per-meal Action Buttons */}
                              <div className="flex gap-2 px-3 py-2 border-t border-gray-100 dark:border-gray-700">
                                <button
                                  onClick={() => handleReorder(order)}
                                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded-lg transition-colors"
                                >
                                  <RotateCcw size={14} />
                                  <span className="text-xs font-medium">Reorder</span>
                                </button>

                                {(order.status === 'pending' || order.status === 'awaiting_payment') && (
                                  <button
                                    onClick={() => setShowCancelDialog(order.id)}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                                  >
                                    <X size={14} />
                                    <span className="text-xs font-medium">Cancel</span>
                                  </button>
                                )}

                                {order.status === 'ready' && (
                                  <div className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 rounded-lg">
                                    <MapPin size={14} />
                                    <span className="text-xs font-medium">Pickup at Canteen</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={Package}
              title="No active orders"
              description="Your today's orders will appear here"
              action={
                <Link 
                  to="/menu" 
                  className="inline-flex items-center gap-2 bg-primary-600 text-white px-6 py-2.5 rounded-lg hover:bg-primary-700 font-medium"
                >
                  Browse Menu
                </Link>
              }
            />
          )}
        </div>
      </PullToRefresh>

      {/* Cancel Order Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!showCancelDialog}
        onCancel={() => setShowCancelDialog(null)}
        onConfirm={() => showCancelDialog && handleCancelOrder(showCancelDialog)}
        title="Cancel Order?"
        message="Are you sure you want to cancel this order? A refund will be processed to your original payment method."
        confirmLabel={cancellingOrder ? 'Cancelling...' : 'Yes, Cancel Order'}
        type="danger"
      />

      {/* Bulk Day Cancellation Modal */}
      <DayCancellationModal
        isOpen={showDayCancelModal}
        onClose={() => setShowDayCancelModal(false)}
        dailyOrders={futureDailyOrders}
        cancelCutoffTime={settings.daily_cancel_cutoff_time}
        onConfirmCancel={async (orderIds) => {
          for (const orderId of orderIds) {
            await cancelOrderMutation.mutateAsync(orderId);
          }
        }}
      />
    </div>
  );
}