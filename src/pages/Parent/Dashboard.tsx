import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, isToday, isTomorrow, parseISO, differenceInMinutes } from 'date-fns';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../services/supabaseClient';
import { useAuth } from '../../hooks/useAuth';
import { useOrderSubscription } from '../../hooks/useOrderSubscription';
import { useCart } from '../../hooks/useCart';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { PullToRefresh } from '../../components/PullToRefresh';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import type { MealPeriod } from '../../types';
import { 
  Package, 
  Clock, 
  ChefHat, 
  RefreshCw, 
  Bell, 
  CalendarClock, 
  Calendar, 
  X, 
  RotateCcw, 
  MapPin, 
  Sparkles,
  Timer,
  XCircle
} from 'lucide-react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Helper to format date in Philippine timezone (UTC+8)
function formatDateLocal(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

interface OrderItem {
  id: string;
  product_id: string;
  quantity: number;
  price_at_order: number;
  product: {
    name: string;
    image_url: string;
  };
}

interface Order {
  id: string;
  status: string;
  payment_status?: string;
  payment_due_at?: string;
  total_amount: number;
  created_at: string;
  scheduled_for: string;
  meal_period?: MealPeriod;
  notes?: string;
  child: {
    id: string;
    first_name: string;
    last_name: string;
  };
  items: OrderItem[];
}

// Get friendly date label
function getScheduledLabel(dateStr: string): string {
  const date = parseISO(dateStr);
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  return format(date, 'EEE, MMM d');
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

// Get estimated wait time
function getEstimatedWait(status: string, createdAt: string): string {
  const elapsed = differenceInMinutes(new Date(), new Date(createdAt));
  if (status === 'pending') {
    const remaining = Math.max(10 - elapsed, 0);
    return remaining > 0 ? `~${remaining}min` : 'Soon';
  }
  if (status === 'preparing') {
    const remaining = Math.max(5 - (elapsed % 10), 0);
    return remaining > 0 ? `~${remaining}min` : 'Almost ready';
  }
  return 'Ready now!';
}

export default function ParentDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { addItem } = useCart();
  const [activeTab, setActiveTab] = useState<'today' | 'scheduled'>('today');
  const [showCancelDialog, setShowCancelDialog] = useState<string | null>(null);
  const [cancellingOrder, setCancellingOrder] = useState(false);
  const [, setTimerTick] = useState(0); // Force re-render for countdown timers
  
  // Subscribe to realtime order updates
  useOrderSubscription();
  
  const todayStr = formatDateLocal(new Date());
  
  // Fetch today's active orders (awaiting_payment, pending, preparing, ready)
  // Also include recently timed out orders so parents can see what happened
  const { data: todayOrders, isLoading: loadingToday, refetch: refetchToday } = useQuery<Order[]>({
    queryKey: ['active-orders', user?.id, todayStr],
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');
      
      // Fetch active orders
      const { data: activeOrders, error: activeError } = await supabase
        .from('orders')
        .select(`
          *,
          child:students!orders_student_id_fkey(id, first_name, last_name),
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
          child:students!orders_student_id_fkey(id, first_name, last_name),
          items:order_items(
            *,
            product:products(name, image_url)
          )
        `)
        .eq('parent_id', user.id)
        .eq('scheduled_for', todayStr)
        .eq('status', 'cancelled')
        .eq('payment_status', 'timeout')
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

  // Fetch scheduled future orders
  const { data: scheduledOrders, isLoading: loadingScheduled, refetch: refetchScheduled } = useQuery<Order[]>({
    queryKey: ['scheduled-orders', user?.id, todayStr],
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          child:students!orders_student_id_fkey(id, first_name, last_name),
          items:order_items(
            *,
            product:products(name, image_url)
          )
        `)
        .eq('parent_id', user.id)
        .gt('scheduled_for', todayStr)
        .in('status', ['awaiting_payment', 'pending'])
        .order('scheduled_for', { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!user
  });

  // Cancel order mutation (via edge function)
  const cancelOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      const response = await fetch(`${SUPABASE_URL}/functions/v1/parent-cancel-order`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
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
      queryClient.invalidateQueries({ queryKey: ['scheduled-orders'] });
      queryClient.invalidateQueries({ queryKey: ['profile'] }); // Refresh balance if refund applied
      showToast(result.message || 'Order cancelled successfully', 'success');
      setShowCancelDialog(null);
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to cancel order', 'error');
    }
  });

  // Reorder functionality - fetches current prices to avoid stale pricing
  const handleReorder = async (order: Order) => {
    const studentName = `${order.child.first_name} ${order.child.last_name}`;
    
    // Fetch current prices for the products
    const productIds = order.items.map(i => i.product_id);
    const { data: currentProducts } = await supabase
      .from('products')
      .select('id, price')
      .in('id', productIds);
    
    const priceMap = new Map((currentProducts || []).map(p => [p.id, p.price as number]));
    let hasPriceChange = false;

    order.items.forEach(item => {
      const currentPrice = priceMap.get(item.product_id);
      if (currentPrice !== undefined && currentPrice !== item.price_at_order) {
        hasPriceChange = true;
      }
      addItem({
        product_id: item.product_id,
        name: item.product.name,
        price: currentPrice ?? item.price_at_order,
        image_url: item.product.image_url,
        quantity: item.quantity,
        student_id: order.child.id,
        student_name: studentName,
        scheduled_for: order.scheduled_for,
        meal_period: order.meal_period || 'lunch'
      });
    });
    showToast(
      hasPriceChange 
        ? 'Items added to cart — some prices have changed' 
        : 'Items added to cart!',
      hasPriceChange ? 'info' : 'success'
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
    await Promise.all([refetchToday(), refetchScheduled()]);
  };
  
  // Real-time countdown timer for payment deadlines
  useEffect(() => {
    // Check if there are any awaiting_payment orders
    const allOrders = [...(todayOrders || []), ...(scheduledOrders || [])];
    const hasAwaitingPayment = allOrders.some(o => 
      (o.status === 'awaiting_payment' || o.payment_status === 'awaiting_payment') && o.payment_due_at
    );
    
    if (!hasAwaitingPayment) return;
    
    // Update every second for real-time countdown
    const interval = setInterval(() => {
      setTimerTick(t => t + 1);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [todayOrders, scheduledOrders]);

  const getStatusDetails = (status: string, paymentStatus?: string) => {
    // Check for timeout first
    if (paymentStatus === 'timeout') {
      return {
        icon: XCircle,
        label: 'Timed Out',
        color: 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
        message: 'Payment expired - Order cancelled',
        progress: 0
      };
    }
    
    // Check for awaiting payment
    if (status === 'awaiting_payment' || paymentStatus === 'awaiting_payment') {
      return {
        icon: Timer,
        label: 'Awaiting Payment',
        color: 'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800',
        message: 'Pay at the counter',
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

  const isLoading = activeTab === 'today' ? loadingToday : loadingScheduled;
  const orders = activeTab === 'today' ? todayOrders : scheduledOrders;

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
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setActiveTab('today')}
              className={`flex-1 py-2.5 rounded-xl font-medium transition-colors flex items-center justify-center gap-2 ${
                activeTab === 'today'
                  ? 'bg-primary-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'
              }`}
            >
              <Bell size={18} />
              Today's Orders
              {todayOrders && todayOrders.length > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                  activeTab === 'today' ? 'bg-primary-500' : 'bg-gray-100 dark:bg-gray-700'
                }`}>
                  {todayOrders.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('scheduled')}
              className={`flex-1 py-2.5 rounded-xl font-medium transition-colors flex items-center justify-center gap-2 ${
                activeTab === 'scheduled'
                  ? 'bg-primary-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'
              }`}
            >
              <CalendarClock size={18} />
              Scheduled
              {scheduledOrders && scheduledOrders.length > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                  activeTab === 'scheduled' ? 'bg-primary-500' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                }`}>
                  {scheduledOrders.length}
                </span>
              )}
            </button>
          </div>

          {isLoading ? (
            <LoadingSpinner size="lg" />
          ) : orders && orders.length > 0 ? (
            <div className="space-y-4">
              {orders.map((order) => {
                const status = getStatusDetails(order.status, order.payment_status);
                const StatusIcon = status.icon;
                const isFutureOrder = activeTab === 'scheduled';
                const isTimedOut = order.payment_status === 'timeout';
                
                return (
                  <div 
                    key={order.id} 
                    className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border-2 overflow-hidden transition-all ${
                      isFutureOrder ? 'border-amber-200 dark:border-amber-800' : status.color
                    } ${order.status === 'ready' ? 'animate-pulse-subtle ring-2 ring-green-400' : ''}`}
                  >
                    {/* Progress Bar */}
                    {!isFutureOrder && (
                      <div className="h-1 bg-gray-100 dark:bg-gray-700">
                        <div 
                          className={`h-full transition-all duration-500 ${
                            order.status === 'pending' ? 'bg-gray-400' :
                            order.status === 'preparing' ? 'bg-yellow-400' : 'bg-green-500'
                          }`}
                          style={{ width: `${status.progress}%` }}
                        />
                      </div>
                    )}
                    
                    {/* Status Banner */}
                    <div className={`px-4 py-3 flex items-center justify-between ${
                      isFutureOrder ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : status.color
                    }`}>
                      <div className="flex items-center gap-2">
                        {isFutureOrder ? (
                          <>
                            <Calendar size={20} />
                            <span className="font-semibold">{getScheduledLabel(order.scheduled_for)}</span>
                          </>
                        ) : (
                          <>
                            <StatusIcon size={20} className={order.status === 'ready' ? 'animate-bounce' : ''} />
                            <span className="font-semibold">{status.label}</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {!isFutureOrder && order.status !== 'ready' && (
                          <span className="text-sm bg-white/50 dark:bg-black/20 px-2 py-0.5 rounded-full">
                            {getEstimatedWait(order.status, order.created_at)}
                          </span>
                        )}
                        <span className="text-sm">
                          {isFutureOrder ? 'Advance Order' : status.message}
                        </span>
                      </div>
                    </div>
                    
                    {/* Ready Banner */}
                    {order.status === 'ready' && (
                      <div className="bg-green-500 text-white px-4 py-2 flex items-center justify-center gap-2">
                        <Sparkles size={16} />
                        <span className="font-medium">Your order is ready for pickup!</span>
                        <Sparkles size={16} />
                      </div>
                    )}
                    
                    {/* Payment Countdown Banner */}
                    {(order.status === 'awaiting_payment' || order.payment_status === 'awaiting_payment') && (
                      <div className="bg-orange-500 text-white px-4 py-2 flex items-center justify-center gap-2">
                        <Timer size={16} className="animate-pulse" />
                        <span className="font-medium">
                          Pay at counter: {getPaymentTimeRemaining(order.payment_due_at).text}
                        </span>
                      </div>
                    )}
                    
                    {/* Timeout Banner */}
                    {isTimedOut && (
                      <div className="bg-red-500 text-white px-4 py-2 flex items-center justify-center gap-2">
                        <XCircle size={16} />
                        <span className="font-medium">Payment expired - Order cancelled</span>
                      </div>
                    )}
                    
                    <div className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100">
                            For {order.child?.first_name || 'Unknown'} {order.child?.last_name || 'Student'}
                          </h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {isFutureOrder 
                              ? format(parseISO(order.scheduled_for), 'EEEE, MMMM d')
                              : `Ordered at ${format(new Date(order.created_at), 'h:mm a')}`
                            }
                          </p>
                        </div>
                        <span className="text-xl font-bold text-primary-600 dark:text-primary-400">
                          ₱{order.total_amount.toFixed(2)}
                        </span>
                      </div>

                      {/* Order Notes */}
                      {order.notes && (
                        <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-2 mb-3">
                          <p className="text-sm text-yellow-800 dark:text-yellow-300">📝 {order.notes}</p>
                        </div>
                      )}

                      {/* Items List */}
                      <div className="space-y-2 mb-4">
                        {order.items.map((item) => (
                          <div key={item.id} className="flex items-center gap-3">
                            {item.product.image_url && (
                              <img
                                src={item.product.image_url}
                                alt={item.product.name}
                                className="w-10 h-10 rounded-lg object-cover"
                              />
                            )}
                            <div className="flex-1">
                              <p className="font-medium text-sm text-gray-900 dark:text-gray-100">{item.product.name}</p>
                            </div>
                            <span className="text-sm text-gray-600 dark:text-gray-400">×{item.quantity}</span>
                          </div>
                        ))}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                        {/* Reorder button - available for all orders */}
                        <button
                          onClick={() => handleReorder(order)}
                          className="flex-1 flex items-center justify-center gap-2 py-2 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded-lg transition-colors"
                        >
                          <RotateCcw size={16} />
                          <span className="text-sm font-medium">Reorder</span>
                        </button>
                        
                        {/* Cancel button - for pending and awaiting_payment orders */}
                        {(order.status === 'pending' || order.status === 'awaiting_payment') && (
                          <button
                            onClick={() => setShowCancelDialog(order.id)}
                            className="flex-1 flex items-center justify-center gap-2 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                          >
                            <X size={16} />
                            <span className="text-sm font-medium">Cancel</span>
                          </button>
                        )}
                        
                        {/* Pickup location for ready orders */}
                        {order.status === 'ready' && (
                          <div className="flex-1 flex items-center justify-center gap-2 py-2 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 rounded-lg">
                            <MapPin size={16} />
                            <span className="text-sm font-medium">Pickup at Canteen</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={activeTab === 'today' ? Package : CalendarClock}
              title={activeTab === 'today' ? 'No active orders' : 'No scheduled orders'}
              description={
                activeTab === 'today' 
                  ? "Your today's orders will appear here" 
                  : "Order ahead for future days from the menu"
              }
              action={
                <Link 
                  to="/menu" 
                  className="inline-flex items-center gap-2 bg-primary-600 text-white px-6 py-2.5 rounded-lg hover:bg-primary-700 font-medium"
                >
                  {activeTab === 'today' ? 'Browse Menu' : 'Order Ahead'}
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
        message="Are you sure you want to cancel this order? Your payment will be refunded to your account balance."
        confirmLabel={cancellingOrder ? 'Cancelling...' : 'Yes, Cancel Order'}
        type="danger"
      />
    </div>
  );
}