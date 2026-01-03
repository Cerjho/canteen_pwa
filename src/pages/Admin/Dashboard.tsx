import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, startOfWeek, startOfMonth, subDays, differenceInMinutes } from 'date-fns';
import { 
  ShoppingBag, 
  Users, 
  Package, 
  DollarSign,
  Clock,
  CheckCircle,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Bell,
  Activity,
  Zap,
  BarChart3,
  PieChart,
  Calendar,
  Target,
  ChevronRight,
  Timer,
  XCircle,
  AlertTriangle,
  Volume2,
  VolumeX,
  Coffee,
  ThumbsUp,
  FileText,
  Award,
  Star,
  WifiOff,
  CreditCard,
  ShieldAlert
} from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { useNavigate } from 'react-router-dom';
import { playNotificationSound } from '../../utils/notificationSound';
import { useAuth } from '../../hooks/useAuth';

// ==================== INTERFACES ====================
interface DashboardStats {
  totalOrdersToday: number;
  totalOrdersWeek: number;
  totalOrdersMonth: number;
  revenueToday: number;
  revenueWeek: number;
  revenueMonth: number;
  pendingOrders: number;
  preparingOrders: number;
  readyOrders: number;
  awaitingPaymentOrders: number;
  completedOrdersToday: number;
  cancelledOrdersToday: number;
  totalParents: number;
  totalStudents: number;
  totalProducts: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  avgOrderValue: number;
  avgFulfillmentTime: number;
  revenueYesterday: number;
  ordersYesterday: number;
  activeParentsToday: number;
  futureOrders: number;
}

interface TopProduct {
  product_id: string;
  name: string;
  total_quantity: number;
  total_revenue: number;
  category?: string;
}

interface RecentOrder {
  id: string;
  status: string;
  total_amount: number;
  created_at: string;
  updated_at?: string;
  completed_at?: string;
  scheduled_for?: string;
  student: { first_name: string; last_name: string } | null;
  parent: { first_name: string; last_name: string } | null;
}

interface OrderStatusDistribution {
  awaiting_payment: number;
  pending: number;
  preparing: number;
  ready: number;
  completed: number;
  cancelled: number;
}

interface HourlyData {
  hour: number;
  orders: number;
  revenue: number;
}

interface LiveActivity {
  id: string;
  type: 'order' | 'user' | 'product' | 'alert' | 'system';
  title: string;
  message: string;
  timestamp: Date;
  severity: 'info' | 'warning' | 'success' | 'error';
}

interface SystemHealth {
  realtime: 'healthy' | 'degraded' | 'down';
}

interface Alert {
  id: string;
  type: 'low_stock' | 'pending_order' | 'cancelled_order' | 'system';
  title: string;
  message: string;
  severity: 'warning' | 'error' | 'info';
  actionLabel?: string;
  actionRoute?: string;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Get today's date in YYYY-MM-DD format using Philippine timezone.
 * Uses toLocaleDateString with Asia/Manila to ensure consistency.
 */
function getTodayDateString(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

/**
 * Get a date string for N days ago in Philippine timezone.
 */
function getDateStringDaysAgo(days: number): string {
  const date = subDays(new Date(), days);
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

/**
 * Get the start of the current week (Monday) in Philippine timezone.
 */
function getWeekStartDateString(): string {
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  return weekStart.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

/**
 * Get the start of the current month in Philippine timezone.
 */
function getMonthStartDateString(): string {
  const monthStart = startOfMonth(new Date());
  return monthStart.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

/**
 * Safely get scheduled_for date, falling back to created_at date.
 * Handles legacy orders that may not have scheduled_for.
 */
function getOrderDate(order: { scheduled_for?: string | null; created_at: string }): string {
  if (order.scheduled_for) {
    return order.scheduled_for;
  }
  // Fallback to created_at date portion for legacy orders
  return format(new Date(order.created_at), 'yyyy-MM-dd');
}

// ==================== MAIN COMPONENT ====================
export default function AdminDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { user } = useAuth();
  
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month'>('today');
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('admin-sound-enabled');
    return saved !== null ? saved === 'true' : true;
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [liveActivities, setLiveActivities] = useState<LiveActivity[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth>({ realtime: 'healthy' });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Get user role from JWT metadata
  const userRole = user?.user_metadata?.role as string | undefined;
  const isStaffOrAdmin = userRole === 'staff' || userRole === 'admin';

  // Save sound preference
  useEffect(() => {
    localStorage.setItem('admin-sound-enabled', String(soundEnabled));
  }, [soundEnabled]);

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Memoized toast function to prevent re-subscriptions
  const stableShowToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    showToast(message, type);
  }, [showToast]);

  // ==================== DATA FETCHING ====================
  const { data: stats, isLoading: statsLoading, refetch: refetchStats, error: statsError } = useQuery<DashboardStats>({
    queryKey: ['admin-dashboard-stats', dateRange],
    queryFn: async () => {
      // Use consistent date strings for comparison with PostgreSQL DATE column
      const todayStr = getTodayDateString();
      const yesterdayStr = getDateStringDaysAgo(1);
      const weekStartStr = getWeekStartDateString();
      const monthStartStr = getMonthStartDateString();

      // Fetch more orders to cover both created_at and completed_at ranges
      // We need orders from the month for historical data
      const [ordersResult, parentsResult, studentsResult, productsResult] = await Promise.all([
        supabase
          .from('orders')
          .select('id, status, total_amount, created_at, updated_at, completed_at, parent_id, scheduled_for')
          .gte('created_at', `${monthStartStr}T00:00:00`),
        // Only count parents (not staff/admin) - filter by role
        supabase
          .from('user_profiles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'parent'),
        supabase
          .from('students')
          .select('*', { count: 'exact', head: true })
          .eq('is_active', true),
        supabase
          .from('products')
          .select('id, stock_quantity, available')
      ]);

      // Check all query errors
      if (ordersResult.error) {
        console.error('Orders query error:', ordersResult.error);
        throw new Error(`Failed to fetch orders: ${ordersResult.error.message}`);
      }
      if (parentsResult.error) {
        console.error('Parents query error:', parentsResult.error);
      }
      if (studentsResult.error) {
        console.error('Students query error:', studentsResult.error);
      }
      if (productsResult.error) {
        console.error('Products query error:', productsResult.error);
      }
      
      const allOrders = ordersResult.data || [];
      const totalParents = parentsResult.count ?? 0;
      const totalStudents = studentsResult.count ?? 0;
      const products = productsResult.data || [];

      const totalProducts = products.length;
      const lowStockProducts = products.filter(p => 
        p.stock_quantity !== null && 
        p.stock_quantity <= 10 && 
        p.stock_quantity > 0 && 
        p.available === true
      ).length;
      const outOfStockProducts = products.filter(p => 
        p.stock_quantity === 0 || p.available === false
      ).length;

      // ===========================================
      // DATE SEMANTICS (CRITICAL):
      // - Orders PLACED today → created_at::date = today
      // - Revenue EARNED today → completed_at::date = today (completed orders only)
      // - Today's WORKLOAD → scheduled_for = today (pending/preparing/ready)
      // - Future orders → scheduled_for > today
      // ===========================================

      // Helper to get date string from timestamp in Philippine timezone
      const getDateFromTimestamp = (timestamp: string): string => {
        return new Date(timestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
      };

      // Orders PLACED today (by created_at) - for avgOrderValue and activeParents
      const ordersPlacedToday = allOrders.filter(o => 
        getDateFromTimestamp(o.created_at) === todayStr
      );

      // Revenue EARNED today (completed_at date for completed orders)
      const ordersCompletedToday = allOrders.filter(o => 
        o.status === 'completed' && 
        o.completed_at && 
        getDateFromTimestamp(o.completed_at) === todayStr
      );
      const ordersCompletedYesterday = allOrders.filter(o => 
        o.status === 'completed' && 
        o.completed_at && 
        getDateFromTimestamp(o.completed_at) === yesterdayStr
      );
      const ordersCompletedThisWeek = allOrders.filter(o => {
        if (o.status !== 'completed' || !o.completed_at) return false;
        const completedDate = getDateFromTimestamp(o.completed_at);
        return completedDate >= weekStartStr && completedDate <= todayStr;
      });
      const ordersCompletedThisMonth = allOrders.filter(o => {
        if (o.status !== 'completed' || !o.completed_at) return false;
        const completedDate = getDateFromTimestamp(o.completed_at);
        return completedDate >= monthStartStr && completedDate <= todayStr;
      });

      // Today's WORKLOAD (scheduled_for = today) - for operational status
      const todaysWorkload = allOrders.filter(o => getOrderDate(o) === todayStr);
      
      // Week/Month workload (by scheduled_for)
      const weeksWorkload = allOrders.filter(o => {
        const orderDate = getOrderDate(o);
        return orderDate >= weekStartStr && orderDate <= todayStr && o.status !== 'cancelled';
      });
      const monthsWorkload = allOrders.filter(o => {
        const orderDate = getOrderDate(o);
        return orderDate >= monthStartStr && orderDate <= todayStr && o.status !== 'cancelled';
      });
      
      // Yesterday's workload
      const yesterdaysWorkload = allOrders.filter(o => 
        getOrderDate(o) === yesterdayStr && o.status !== 'cancelled'
      );
      
      // Future scheduled orders
      const futureOrders = allOrders.filter(o => {
        const orderDate = getOrderDate(o);
        return orderDate > todayStr && o.status !== 'cancelled';
      }).length;

      // Calculate fulfillment time from orders completed today
      let avgFulfillmentTime = 0;
      if (ordersCompletedToday.length > 0) {
        const times = ordersCompletedToday
          .filter((o): o is typeof o & { completed_at: string } => Boolean(o.completed_at))
          .map(o => differenceInMinutes(new Date(o.completed_at), new Date(o.created_at)));
        avgFulfillmentTime = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
      }

      // Revenue calculations (based on completed orders)
      const revenueToday = ordersCompletedToday.reduce((sum, o) => sum + (o.total_amount ?? 0), 0);
      const revenueYesterday = ordersCompletedYesterday.reduce((sum, o) => sum + (o.total_amount ?? 0), 0);
      const revenueWeek = ordersCompletedThisWeek.reduce((sum, o) => sum + (o.total_amount ?? 0), 0);
      const revenueMonth = ordersCompletedThisMonth.reduce((sum, o) => sum + (o.total_amount ?? 0), 0);

      // Average order value (from orders placed today, excluding cancelled)
      const nonCancelledPlacedToday = ordersPlacedToday.filter(o => o.status !== 'cancelled');
      const avgOrderValue = nonCancelledPlacedToday.length > 0 
        ? nonCancelledPlacedToday.reduce((sum, o) => sum + (o.total_amount ?? 0), 0) / nonCancelledPlacedToday.length 
        : 0;

      // Active parents (unique parents who placed orders today)
      const activeParentsToday = new Set(ordersPlacedToday.map(o => o.parent_id)).size;

      // Cancelled today (orders cancelled today, by updated_at since that's when status changed)
      const cancelledToday = allOrders.filter(o => 
        o.status === 'cancelled' && 
        o.updated_at &&
        getDateFromTimestamp(o.updated_at) === todayStr
      ).length;

      return {
        // Orders scheduled for today/week/month (by scheduled_for - operational workload)
        totalOrdersToday: todaysWorkload.filter(o => o.status !== 'cancelled').length,
        totalOrdersWeek: weeksWorkload.length,
        totalOrdersMonth: monthsWorkload.length,
        ordersYesterday: yesterdaysWorkload.length,
        
        // Revenue earned (by completed_at)
        revenueToday,
        revenueYesterday,
        revenueWeek,
        revenueMonth,
        
        // Today's operational status (by scheduled_for = today)
        pendingOrders: todaysWorkload.filter(o => o.status === 'pending').length,
        preparingOrders: todaysWorkload.filter(o => o.status === 'preparing').length,
        readyOrders: todaysWorkload.filter(o => o.status === 'ready').length,
        awaitingPaymentOrders: todaysWorkload.filter(o => o.status === 'awaiting_payment').length,
        
        // Completed/cancelled today (by actual completion/cancellation time)
        completedOrdersToday: ordersCompletedToday.length,
        cancelledOrdersToday: cancelledToday,
        
        // Counts
        totalParents,
        totalStudents,
        totalProducts,
        lowStockProducts,
        outOfStockProducts,
        
        // Metrics
        avgOrderValue,
        avgFulfillmentTime,
        activeParentsToday,
        futureOrders
      };
    },
    refetchInterval: 10000,
    enabled: isStaffOrAdmin // Only fetch if user has permission
  });

  const { data: statusDistribution } = useQuery<OrderStatusDistribution>({
    queryKey: ['admin-status-distribution', dateRange],
    queryFn: async () => {
      const todayStr = getTodayDateString();
      const startDateStr = dateRange === 'today' 
        ? todayStr
        : dateRange === 'week' ? getWeekStartDateString() : getMonthStartDateString();
      
      // Fetch orders by scheduled_for date range (operational workload)
      const { data: orders, error } = await supabase
        .from('orders')
        .select('status, scheduled_for')
        .gte('scheduled_for', startDateStr)
        .lte('scheduled_for', todayStr);

      if (error) {
        console.error('Status distribution query error:', error);
        return { awaiting_payment: 0, pending: 0, preparing: 0, ready: 0, completed: 0, cancelled: 0 };
      }

      const distribution: OrderStatusDistribution = { 
        awaiting_payment: 0, 
        pending: 0, 
        preparing: 0, 
        ready: 0, 
        completed: 0, 
        cancelled: 0 
      };
      
      (orders || []).forEach(order => {
        const status = order.status as keyof OrderStatusDistribution;
        if (status in distribution) {
          distribution[status]++;
        }
      });
      
      return distribution;
    },
    refetchInterval: 10000,
    enabled: isStaffOrAdmin
  });

  const { data: hourlyData } = useQuery<HourlyData[]>({
    queryKey: ['admin-hourly-data', dateRange],
    queryFn: async () => {
      const todayStr = getTodayDateString();
      const startDateStr = dateRange === 'today' 
        ? todayStr
        : dateRange === 'week' ? getWeekStartDateString() : getMonthStartDateString();
      
      // Fetch by scheduled_for and use created_at time for hourly distribution
      const { data: orders, error } = await supabase
        .from('orders')
        .select('total_amount, created_at, scheduled_for, status')
        .gte('scheduled_for', startDateStr)
        .lte('scheduled_for', todayStr)
        .neq('status', 'cancelled');

      if (error) {
        console.error('Hourly data query error:', error);
        return [];
      }

      // Initialize hourly buckets for operating hours (6 AM to 6 PM local time)
      const hourlyMap: Record<number, HourlyData> = {};
      for (let i = 6; i <= 18; i++) {
        hourlyMap[i] = { hour: i, orders: 0, revenue: 0 };
      }

      // Group orders by the LOCAL hour they were created
      // getHours() already returns local time hour from Date object
      (orders || []).forEach(order => {
        const localDate = new Date(order.created_at);
        const localHour = localDate.getHours(); // This is already local time
        if (hourlyMap[localHour]) {
          hourlyMap[localHour].orders++;
          hourlyMap[localHour].revenue += order.total_amount ?? 0;
        }
      });

      return Object.values(hourlyMap).sort((a, b) => a.hour - b.hour);
    },
    refetchInterval: 30000,
    enabled: isStaffOrAdmin
  });

  const { data: topProducts } = useQuery<TopProduct[]>({
    queryKey: ['admin-top-products', dateRange],
    queryFn: async () => {
      const todayStr = getTodayDateString();
      const startDateStr = dateRange === 'today' 
        ? todayStr
        : dateRange === 'week' ? getWeekStartDateString() : getMonthStartDateString();

      // Use scheduled_for to find orders for this period's workload
      const { data: orderItems, error } = await supabase
        .from('order_items')
        .select(`
          quantity, 
          price_at_order, 
          product_id, 
          order:orders!inner(scheduled_for, status), 
          product:products(name, category)
        `)
        .gte('order.scheduled_for', startDateStr)
        .lte('order.scheduled_for', todayStr)
        .neq('order.status', 'cancelled');

      if (error) {
        console.error('Top products query error:', error);
        return [];
      }

      // Type-safe handling of Supabase joined data
      interface OrderItemResult {
        quantity: number;
        price_at_order: number;
        product_id: string;
        order: { scheduled_for: string; status: string } | Array<{ scheduled_for: string; status: string }>;
        product: { name: string; category: string } | Array<{ name: string; category: string }> | null;
      }

      const productMap: Record<string, TopProduct> = {};
      
      ((orderItems || []) as OrderItemResult[]).forEach((item) => {
        const id = item.product_id;
        // Handle Supabase returning either array or single object for joins
        const product = Array.isArray(item.product) ? item.product[0] : item.product;
        
        if (!productMap[id]) {
          productMap[id] = { 
            product_id: id, 
            name: product?.name || 'Unknown Product', 
            category: product?.category, 
            total_quantity: 0, 
            total_revenue: 0 
          };
        }
        productMap[id].total_quantity += item.quantity ?? 0;
        productMap[id].total_revenue += (item.quantity ?? 0) * (item.price_at_order ?? 0);
      });

      return Object.values(productMap)
        .sort((a, b) => b.total_revenue - a.total_revenue)
        .slice(0, 5);
    },
    refetchInterval: 30000,
    enabled: isStaffOrAdmin
  });

  const { data: recentOrders, refetch: refetchOrders } = useQuery<RecentOrder[]>({
    queryKey: ['admin-recent-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, 
          status, 
          total_amount, 
          created_at, 
          updated_at, 
          completed_at,
          scheduled_for,
          student:students!orders_student_id_fkey(first_name, last_name), 
          parent:user_profiles(first_name, last_name)
        `)
        .order('created_at', { ascending: false })
        .limit(8);
      
      if (error) {
        console.error('Recent orders query error:', error);
        return [];
      }

      // Type-safe mapping of Supabase joined data
      interface OrderResult {
        id: string;
        status: string;
        total_amount: number;
        created_at: string;
        updated_at?: string;
        completed_at?: string;
        scheduled_for?: string;
        student: Array<{ first_name: string; last_name: string }> | { first_name: string; last_name: string } | null;
        parent: Array<{ first_name: string; last_name: string }> | { first_name: string; last_name: string } | null;
      }

      return ((data || []) as OrderResult[]).map((order) => ({
        id: order.id,
        status: order.status,
        total_amount: order.total_amount,
        created_at: order.created_at,
        updated_at: order.updated_at,
        completed_at: order.completed_at,
        scheduled_for: order.scheduled_for,
        student: Array.isArray(order.student) ? order.student[0] || null : order.student,
        parent: Array.isArray(order.parent) ? order.parent[0] || null : order.parent
      }));
    },
    refetchInterval: 5000,
    enabled: isStaffOrAdmin
  });

  const { data: alerts } = useQuery<Alert[]>({
    queryKey: ['admin-alerts'],
    queryFn: async () => {
      const alertsList: Alert[] = [];

      // Check for low stock products
      const { data: lowStock, error: lowStockError } = await supabase
        .from('products')
        .select('name, stock_quantity')
        .lte('stock_quantity', 10)
        .gt('stock_quantity', 0)
        .eq('available', true);

      if (lowStockError) {
        console.error('Low stock query error:', lowStockError);
      } else {
        (lowStock || []).forEach(product => {
          alertsList.push({
            id: `low-stock-${product.name}`,
            type: 'low_stock',
            title: 'Low Stock Alert',
            message: `${product.name} has only ${product.stock_quantity} items left`,
            severity: (product.stock_quantity ?? 0) <= 5 ? 'error' : 'warning',
            actionLabel: 'Manage Products',
            actionRoute: '/admin/products'
          });
        });
      }

      // Only alert on TODAY's orders that have been pending for more than 10 minutes
      // Don't alert on future scheduled orders
      const todayStr = getTodayDateString();
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      
      const { data: oldPending, error: pendingError } = await supabase
        .from('orders')
        .select('id')
        .eq('status', 'pending')
        .eq('scheduled_for', todayStr)
        .lt('created_at', tenMinutesAgo.toISOString());

      if (pendingError) {
        console.error('Pending orders query error:', pendingError);
      } else if (oldPending && oldPending.length > 0) {
        alertsList.push({
          id: 'old-pending-orders',
          type: 'pending_order',
          title: 'Orders Need Attention',
          message: `${oldPending.length} order${oldPending.length > 1 ? 's' : ''} waiting for more than 10 minutes`,
          severity: 'warning',
          actionLabel: 'View Orders',
          actionRoute: '/admin/orders'
        });
      }

      // Check for orders awaiting payment
      const { data: awaitingPayment, error: awaitingError } = await supabase
        .from('orders')
        .select('id')
        .eq('status', 'awaiting_payment')
        .eq('scheduled_for', todayStr);

      if (awaitingError) {
        console.error('Awaiting payment query error:', awaitingError);
      } else if (awaitingPayment && awaitingPayment.length > 0) {
        alertsList.push({
          id: 'awaiting-payment-orders',
          type: 'pending_order',
          title: 'Cash Payments Pending',
          message: `${awaitingPayment.length} order${awaitingPayment.length > 1 ? 's' : ''} awaiting cash payment confirmation`,
          severity: 'info',
          actionLabel: 'View Orders',
          actionRoute: '/admin/orders?status=awaiting_payment'
        });
      }

      return alertsList.slice(0, 5);
    },
    refetchInterval: 30000,
    enabled: isStaffOrAdmin
  });

  // ==================== REAL-TIME SUBSCRIPTIONS ====================
  useEffect(() => {
    if (!isOnline || !isStaffOrAdmin) return;

    const channel = supabase
      .channel('admin-dashboard-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
        // Play notification sound
        if (soundEnabled) {
          playNotificationSound(0.5);
        }
        
        // Show toast notification
        stableShowToast('🔔 New order received!', 'info');
        
        const newActivity: LiveActivity = {
          id: `order-${payload.new.id}`,
          type: 'order',
          title: 'New Order',
          message: `Order #${(payload.new.id as string).slice(-6).toUpperCase()} - ₱${payload.new.total_amount}`,
          timestamp: new Date(),
          severity: 'success'
        };
        setLiveActivities(prev => [newActivity, ...prev].slice(0, 20));
        
        // Invalidate relevant queries
        queryClient.invalidateQueries({ queryKey: ['admin-dashboard-stats'] });
        queryClient.invalidateQueries({ queryKey: ['admin-recent-orders'] });
        queryClient.invalidateQueries({ queryKey: ['admin-status-distribution'] });
        queryClient.invalidateQueries({ queryKey: ['admin-hourly-data'] });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
        const statusMessages: Record<string, string> = {
          awaiting_payment: '💳 Order awaiting payment',
          preparing: '🍳 Order is being prepared',
          ready: '✅ Order is ready for pickup',
          completed: '🎉 Order completed',
          cancelled: '❌ Order was cancelled'
        };
        
        const status = payload.new.status as string;
        if (statusMessages[status]) {
          stableShowToast(statusMessages[status], status === 'cancelled' ? 'error' : 'success');
        }

        const newActivity: LiveActivity = {
          id: `order-update-${payload.new.id}-${Date.now()}`,
          type: 'order',
          title: 'Order Updated',
          message: `Order #${(payload.new.id as string).slice(-6).toUpperCase()} → ${payload.new.status}`,
          timestamp: new Date(),
          severity: payload.new.status === 'cancelled' ? 'error' : payload.new.status === 'ready' ? 'success' : 'info'
        };
        setLiveActivities(prev => [newActivity, ...prev].slice(0, 20));
        
        queryClient.invalidateQueries({ queryKey: ['admin-dashboard-stats'] });
        queryClient.invalidateQueries({ queryKey: ['admin-recent-orders'] });
        queryClient.invalidateQueries({ queryKey: ['admin-status-distribution'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
        // Track product changes
        const newActivity: LiveActivity = {
          id: `product-${Date.now()}`,
          type: 'product',
          title: 'Product Updated',
          message: payload.eventType === 'INSERT' ? 'New product added' : 'Product availability changed',
          timestamp: new Date(),
          severity: 'info'
        };
        setLiveActivities(prev => [newActivity, ...prev].slice(0, 20));
        
        queryClient.invalidateQueries({ queryKey: ['admin-top-products'] });
        queryClient.invalidateQueries({ queryKey: ['admin-alerts'] });
        queryClient.invalidateQueries({ queryKey: ['admin-dashboard-stats'] });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_profiles' }, () => {
        // Track new user registrations
        const newActivity: LiveActivity = {
          id: `user-${Date.now()}`,
          type: 'user',
          title: 'New User',
          message: 'A new user has registered',
          timestamp: new Date(),
          severity: 'success'
        };
        setLiveActivities(prev => [newActivity, ...prev].slice(0, 20));
        queryClient.invalidateQueries({ queryKey: ['admin-dashboard-stats'] });
      })
      .subscribe((status, err) => {
        if (err) {
          console.error('Realtime subscription error:', err);
          setSystemHealth({ realtime: 'down' });
          stableShowToast('Real-time connection lost', 'error');
        } else {
          setSystemHealth({ realtime: status === 'SUBSCRIBED' ? 'healthy' : 'degraded' });
        }
      });

    return () => { 
      supabase.removeChannel(channel); 
    };
  }, [soundEnabled, queryClient, isOnline, stableShowToast, isStaffOrAdmin]);

  // ==================== HANDLERS ====================
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        refetchStats(),
        refetchOrders(),
        queryClient.invalidateQueries({ queryKey: ['admin-top-products'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-status-distribution'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-hourly-data'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-alerts'] })
      ]);
      showToast('Dashboard refreshed', 'success');
    } catch (error) {
      showToast('Failed to refresh data', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  // ==================== COMPUTED VALUES ====================
  const revenueTrend = useMemo(() => {
    if (!stats) return 0;
    const yesterday = stats.revenueYesterday || 0;
    const today = stats.revenueToday || 0;
    if (yesterday === 0) return today > 0 ? 100 : 0;
    return ((today - yesterday) / yesterday) * 100;
  }, [stats]);

  const ordersTrend = useMemo(() => {
    if (!stats) return 0;
    const yesterday = stats.ordersYesterday || 0;
    const today = stats.totalOrdersToday || 0;
    if (yesterday === 0) return today > 0 ? 100 : 0;
    return ((today - yesterday) / yesterday) * 100;
  }, [stats]);

  const fulfillmentRate = useMemo(() => {
    if (!stats || stats.totalOrdersToday === 0) return 0;
    return (stats.completedOrdersToday / stats.totalOrdersToday) * 100;
  }, [stats]);

  const peakHour = useMemo(() => {
    if (!hourlyData) return null;
    const peak = hourlyData.reduce((max, curr) => curr.orders > max.orders ? curr : max, hourlyData[0]);
    return peak?.orders > 0 ? peak : null;
  }, [hourlyData]);

  // ==================== HELPERS ====================
  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      awaiting_payment: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800',
      pending: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
      preparing: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800',
      ready: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
      completed: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600',
      cancelled: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800'
    };
    return colors[status] || colors.pending;
  };

  const getStatusIcon = (status: string) => {
    const icons: Record<string, React.ReactNode> = {
      awaiting_payment: <CreditCard size={14} />,
      pending: <Clock size={14} />,
      preparing: <Coffee size={14} />,
      ready: <CheckCircle size={14} />,
      completed: <ThumbsUp size={14} />,
      cancelled: <XCircle size={14} />
    };
    return icons[status] || icons.pending;
  };

  const formatTime = (date: Date) => format(date, 'h:mm:ss a');

  // ==================== LOADING STATE ====================
  if (statsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-500 dark:text-gray-400">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // ==================== AUTHORIZATION CHECK ====================
  if (!isStaffOrAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
            <ShieldAlert size={32} className="text-red-600 dark:text-red-400" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Access Denied</h2>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            You don't have permission to access the admin dashboard. 
            Please contact your administrator if you believe this is an error.
          </p>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  // ==================== ERROR STATE ====================
  if (statsError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
            <AlertTriangle size={32} className="text-red-600 dark:text-red-400" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Failed to load dashboard</h2>
          <p className="text-gray-500 dark:text-gray-400 mb-4">There was an error fetching the dashboard data. Please check your connection and try again.</p>
          <button
            onClick={() => refetchStats()}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // ==================== RENDER ====================
  return (
    <div className="min-h-screen pb-20 bg-gray-50 dark:bg-gray-900">
      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-red-600 text-white text-center py-2 px-4 flex items-center justify-center gap-2">
          <WifiOff size={16} />
          <span className="text-sm font-medium">You are offline. Some features may not work.</span>
        </div>
      )}
      
      <div className="container mx-auto px-4 py-6">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Activity className="text-primary-600 dark:text-primary-400" />
              Admin Dashboard
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-2">
              <Clock size={14} />
              {format(currentTime, 'EEEE, MMMM d, yyyy')} • {formatTime(currentTime)}
            </p>
          </div>
          
          <div className="flex items-center gap-2 mt-4 md:mt-0">
            {/* Connection Status */}
            <div className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border ${
              systemHealth.realtime === 'healthy' 
                ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800' 
                : systemHealth.realtime === 'degraded'
                  ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800'
                  : 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                systemHealth.realtime === 'healthy' 
                  ? 'bg-green-500 animate-pulse' 
                  : systemHealth.realtime === 'degraded'
                    ? 'bg-amber-500'
                    : 'bg-red-500'
              }`} />
              <span className={`text-xs font-medium ${
                systemHealth.realtime === 'healthy' 
                  ? 'text-green-700 dark:text-green-400' 
                  : systemHealth.realtime === 'degraded'
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-red-700 dark:text-red-400'
              }`}>
                {systemHealth.realtime === 'healthy' ? 'Live' : systemHealth.realtime === 'degraded' ? 'Connecting...' : 'Disconnected'}
              </span>
            </div>
            
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg transition-colors ${soundEnabled ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}`}
              title={soundEnabled ? 'Mute notifications' : 'Enable notifications'}
            >
              {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            
            <button
              onClick={handleRefresh}
              disabled={isRefreshing || !isOnline}
              className="p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              title="Refresh data"
            >
              <RefreshCw size={18} className={`text-gray-600 dark:text-gray-400 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Alerts Section */}
        {alerts && alerts.length > 0 && (
          <div className="mb-6 space-y-2">
            {alerts.slice(0, 3).map(alert => (
              <div
                key={alert.id}
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  alert.severity === 'error' ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300' 
                    : alert.severity === 'warning' ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                    : 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <AlertTriangle size={18} className="flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm">{alert.title}</p>
                    <p className="text-sm opacity-80">{alert.message}</p>
                  </div>
                </div>
                {alert.actionLabel && alert.actionRoute && (
                  <button
                    onClick={() => navigate(alert.actionRoute as string)}
                    className="px-3 py-1 text-sm font-medium rounded-md bg-white/50 dark:bg-white/10 hover:bg-white dark:hover:bg-white/20 transition-colors"
                  >
                    {alert.actionLabel}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Primary KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div 
            className={`rounded-xl p-4 border-2 cursor-pointer transition-all hover:shadow-md ${
              (stats?.pendingOrders || 0) > 0 ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 animate-pulse-subtle' : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
            }`}
            onClick={() => navigate('/admin/orders?status=pending')}
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`p-2 rounded-lg ${(stats?.pendingOrders || 0) > 0 ? 'bg-amber-200 dark:bg-amber-800 text-amber-700 dark:text-amber-300' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
                <Clock size={20} />
              </div>
              {(stats?.pendingOrders || 0) > 0 && (
                <span className="flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                </span>
              )}
            </div>
            <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{stats?.pendingOrders || 0}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">Pending Orders</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {(stats?.preparingOrders || 0) > 0 && (
                <span className="text-xs text-blue-600 dark:text-blue-400">{stats?.preparingOrders} preparing</span>
              )}
              {(stats?.awaitingPaymentOrders || 0) > 0 && (
                <span className="text-xs text-purple-600 dark:text-purple-400">{stats?.awaitingPaymentOrders} awaiting pay</span>
              )}
            </div>
          </div>

          <div 
            className={`rounded-xl p-4 border-2 cursor-pointer transition-all hover:shadow-md ${
              (stats?.readyOrders || 0) > 0 ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700' : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
            }`}
            onClick={() => navigate('/admin/orders?status=ready')}
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`p-2 rounded-lg ${(stats?.readyOrders || 0) > 0 ? 'bg-green-200 dark:bg-green-800 text-green-700 dark:text-green-300' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
                <CheckCircle size={20} />
              </div>
              {(stats?.readyOrders || 0) > 0 && <Bell size={16} className="text-green-600 dark:text-green-400 animate-bounce" />}
            </div>
            <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{stats?.readyOrders || 0}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">Ready for Pickup</p>
            <p className="text-xs text-green-600 dark:text-green-400 mt-1">{stats?.completedOrdersToday || 0} completed today</p>
          </div>

          <div className="rounded-xl p-4 bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 rounded-lg bg-white/20 dark:bg-white/10"><DollarSign size={20} /></div>
              <div className={`flex items-center text-xs ${revenueTrend >= 0 ? 'text-emerald-200' : 'text-red-200'}`}>
                {revenueTrend >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {Math.abs(revenueTrend).toFixed(0)}%
              </div>
            </div>
            <p className="text-3xl font-bold">₱{(stats?.revenueToday || 0).toLocaleString('en-PH', { minimumFractionDigits: 0 })}</p>
            <p className="text-sm opacity-90">Revenue Today</p>
            <p className="text-xs opacity-75 mt-1">vs ₱{(stats?.revenueYesterday || 0).toLocaleString()} yesterday</p>
          </div>

          <div className="rounded-xl p-4 bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 rounded-lg bg-white/20 dark:bg-white/10"><ShoppingBag size={20} /></div>
              <div className={`flex items-center text-xs ${ordersTrend >= 0 ? 'text-blue-200' : 'text-red-200'}`}>
                {ordersTrend >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {Math.abs(ordersTrend).toFixed(0)}%
              </div>
            </div>
            <p className="text-3xl font-bold">{stats?.totalOrdersToday || 0}</p>
            <p className="text-sm opacity-90">Orders Today</p>
            <p className="text-xs opacity-75 mt-1">{stats?.activeParentsToday || 0} unique customers</p>
          </div>
        </div>

        {/* Secondary Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <StatCard title="Avg Order Value" value={`₱${(stats?.avgOrderValue || 0).toFixed(0)}`} icon={Target} color="purple" />
          <StatCard title="Avg Fulfillment" value={`${Math.round(stats?.avgFulfillmentTime || 0)} min`} icon={Timer} color="indigo" subtitle={fulfillmentRate > 80 ? 'Good' : 'Needs improvement'} />
          <StatCard title="Low Stock Items" value={stats?.lowStockProducts || 0} icon={Package} color={(stats?.lowStockProducts || 0) > 0 ? 'red' : 'gray'} onClick={() => navigate('/admin/products?filter=low-stock')} clickable />
          <StatCard title="Cancelled Today" value={stats?.cancelledOrdersToday || 0} icon={XCircle} color={(stats?.cancelledOrdersToday || 0) > 0 ? 'red' : 'gray'} />
          <StatCard title="Awaiting Payment" value={stats?.awaitingPaymentOrders || 0} icon={CreditCard} color={(stats?.awaitingPaymentOrders || 0) > 0 ? 'purple' : 'gray'} onClick={() => navigate('/admin/orders?status=awaiting_payment')} clickable />
          <StatCard title="Future Orders" value={stats?.futureOrders || 0} icon={Calendar} color={(stats?.futureOrders || 0) > 0 ? 'blue' : 'gray'} subtitle="Scheduled ahead" onClick={() => navigate('/admin/orders?filter=future')} clickable />
        </div>

        {/* Date Range Selector */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex gap-2 bg-white dark:bg-gray-800 rounded-lg p-1 shadow-sm border border-gray-200 dark:border-gray-700">
            {(['today', 'week', 'month'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setDateRange(range)}
                className={`px-4 py-2 rounded-md font-medium text-sm transition-all ${
                  dateRange === range ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {range === 'today' ? 'Today' : range === 'week' ? 'This Week' : 'This Month'}
              </button>
            ))}
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <Calendar size={14} />
            {dateRange === 'today' && format(new Date(), 'MMM d')}
            {dateRange === 'week' && `${format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'MMM d')} - ${format(new Date(), 'MMM d')}`}
            {dateRange === 'month' && format(new Date(), 'MMMM yyyy')}
          </div>
        </div>

        {/* Charts & Analytics Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <PieChart size={18} className="text-gray-400 dark:text-gray-500" />
                Order Status ({dateRange === 'today' ? 'Today' : dateRange === 'week' ? 'This Week' : 'This Month'})
              </h3>
            </div>
            <div className="p-4">
              <StatusDistributionChart distribution={statusDistribution} dateRange={dateRange} />
            </div>
          </div>

          <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <BarChart3 size={18} className="text-gray-400 dark:text-gray-500" />
                Orders by Hour ({dateRange === 'today' ? 'Today' : dateRange === 'week' ? 'This Week' : 'This Month'})
              </h3>
              {peakHour && (
                <span className="text-xs px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full flex items-center gap-1">
                  <Zap size={12} />
                  Peak: {peakHour.hour > 12 ? peakHour.hour - 12 : peakHour.hour}:00 {peakHour.hour >= 12 ? 'PM' : 'AM'}
                </span>
              )}
            </div>
            <div className="p-4">
              <HourlyChart data={hourlyData || []} dateRange={dateRange} />
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Top Products */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Award size={18} className="text-amber-500 dark:text-amber-400" />
                Top Products
              </h3>
              <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">{dateRange}</span>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {topProducts?.length === 0 ? (
                <p className="p-4 text-center text-gray-500 dark:text-gray-400">No sales data yet</p>
              ) : (
                topProducts?.map((product, index) => (
                  <div key={product.product_id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                      index === 0 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 ring-2 ring-amber-300 dark:ring-amber-700' :
                      index === 1 ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300' :
                      index === 2 ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' :
                      'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                    }`}>
                      {index === 0 ? <Star size={16} /> : index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{product.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{product.total_quantity} sold</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-green-600 dark:text-green-400">₱{product.total_revenue.toFixed(0)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700">
              <button onClick={() => navigate('/admin/reports')} className="w-full text-center text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium flex items-center justify-center gap-1">
                View Full Report <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {/* Recent Orders */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <ShoppingBag size={18} className="text-blue-500 dark:text-blue-400" />
                Recent Orders
              </h3>
              <span className="flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-96 overflow-y-auto">
              {recentOrders?.map((order) => {
                const studentName = order.student 
                  ? `${order.student.first_name} ${order.student.last_name}` 
                  : 'Unknown Student';
                return (
                  <div key={order.id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer" onClick={() => navigate(`/admin/orders?id=${order.id}`)}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{studentName}</p>
                        <span className="text-xs text-gray-400 dark:text-gray-500">#{order.id.slice(-6).toUpperCase()}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border flex items-center gap-1 ${getStatusColor(order.status)}`}>
                        {getStatusIcon(order.status)}
                        {order.status === 'awaiting_payment' ? 'awaiting' : order.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <p className="text-gray-500 dark:text-gray-400">{format(new Date(order.created_at), 'h:mm a')}</p>
                      <p className="font-semibold text-gray-700 dark:text-gray-300">₱{order.total_amount.toFixed(2)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700">
              <button onClick={() => navigate('/admin/orders')} className="w-full text-center text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium flex items-center justify-center gap-1">
                View All Orders <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {/* Live Activity Feed */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Activity size={18} className="text-purple-500 dark:text-purple-400" />
                Live Activity
              </h3>
              <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                Real-time
              </span>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-96 overflow-y-auto">
              {liveActivities.length === 0 ? (
                <div className="p-8 text-center">
                  <Activity size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                  <p className="text-gray-500 dark:text-gray-400 text-sm">Waiting for activity...</p>
                  <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">New orders will appear here</p>
                </div>
              ) : (
                liveActivities.map((activity) => (
                  <div key={activity.id} className="px-4 py-3 animate-slide-in">
                    <div className="flex items-start gap-3">
                      <div className={`p-1.5 rounded-full flex-shrink-0 ${
                        activity.severity === 'success' ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' :
                        activity.severity === 'error' ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' :
                        activity.severity === 'warning' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' :
                        'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                      }`}>
                        {activity.type === 'order' ? <ShoppingBag size={14} /> : activity.type === 'user' ? <Users size={14} /> : <Activity size={14} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{activity.title}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{activity.message}</p>
                      </div>
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">{format(activity.timestamp, 'h:mm a')}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Quick Stats Footer */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <QuickStatCard icon={<Users size={18} />} label="Total Parents" value={stats?.totalParents || 0} onClick={() => navigate('/admin/users')} />
          <QuickStatCard icon={<Package size={18} />} label="Total Products" value={stats?.totalProducts || 0} onClick={() => navigate('/admin/products')} />
          <QuickStatCard icon={<ShoppingBag size={18} />} label="Weekly Orders" value={stats?.totalOrdersWeek || 0} />
          <QuickStatCard icon={<DollarSign size={18} />} label="Monthly Revenue" value={`₱${((stats?.revenueMonth || 0) / 1000).toFixed(1)}k`} />
        </div>

        {/* Quick Actions */}
        <div className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <Zap size={18} className="text-amber-500 dark:text-amber-400" />
            Quick Actions
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <QuickActionButton icon={<ShoppingBag size={18} />} label="Manage Orders" onClick={() => navigate('/admin/orders')} color="blue" />
            <QuickActionButton icon={<Package size={18} />} label="Update Products" onClick={() => navigate('/admin/products')} color="green" />
            <QuickActionButton icon={<Calendar size={18} />} label="Weekly Menu" onClick={() => navigate('/admin/weekly-menu')} color="purple" />
            <QuickActionButton icon={<FileText size={18} />} label="View Reports" onClick={() => navigate('/admin/reports')} color="amber" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== CHILD COMPONENTS ====================
interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  color: 'yellow' | 'green' | 'blue' | 'red' | 'gray' | 'purple' | 'indigo';
  subtitle?: string;
  onClick?: () => void;
  clickable?: boolean;
}

function StatCard({ title, value, icon: Icon, color, subtitle, onClick, clickable }: StatCardProps) {
  const colorStyles: Record<string, string> = {
    yellow: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-700',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-700',
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-700',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-700',
    gray: 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-700',
    indigo: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-700'
  };
  const iconBg: Record<string, string> = {
    yellow: 'bg-amber-100 dark:bg-amber-800', green: 'bg-green-100 dark:bg-green-800', blue: 'bg-blue-100 dark:bg-blue-800', red: 'bg-red-100 dark:bg-red-800', gray: 'bg-gray-100 dark:bg-gray-700', purple: 'bg-purple-100 dark:bg-purple-800', indigo: 'bg-indigo-100 dark:bg-indigo-800'
  };

  return (
    <div className={`rounded-xl p-4 border ${colorStyles[color]} ${clickable ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`} onClick={onClick}>
      <div className="flex items-center justify-between mb-2">
        <div className={`p-2 rounded-lg ${iconBg[color]}`}><Icon size={18} /></div>
        {clickable && <ChevronRight size={14} className="opacity-50" />}
      </div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm opacity-75">{title}</p>
      {subtitle && <p className="text-xs opacity-60 mt-1">{subtitle}</p>}
    </div>
  );
}

interface QuickStatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  onClick?: () => void;
}

function QuickStatCard({ icon, label, value, onClick }: QuickStatCardProps) {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`} onClick={onClick}>
      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-2">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  );
}

interface QuickActionButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  color: 'blue' | 'green' | 'purple' | 'amber';
}

function QuickActionButton({ icon, label, onClick, color }: QuickActionButtonProps) {
  const colors = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 border-blue-200 dark:border-blue-700',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 border-green-200 dark:border-green-700',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/30 border-purple-200 dark:border-purple-700',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 border-amber-200 dark:border-amber-700'
  };
  return (
    <button onClick={onClick} className={`flex items-center justify-center gap-2 p-3 rounded-lg border font-medium transition-colors ${colors[color]}`}>
      {icon}
      <span className="text-sm">{label}</span>
    </button>
  );
}

interface StatusDistributionChartProps {
  distribution?: OrderStatusDistribution;
  dateRange: 'today' | 'week' | 'month';
}

function StatusDistributionChart({ distribution, dateRange }: StatusDistributionChartProps) {
  if (!distribution) return <div className="h-40 flex items-center justify-center text-gray-400 dark:text-gray-500">Loading...</div>;

  const total = Object.values(distribution).reduce((a, b) => a + b, 0);
  const periodLabel = dateRange === 'today' ? 'today' : dateRange === 'week' ? 'this week' : 'this month';
  
  if (total === 0) {
    return (
      <div className="h-40 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
        <PieChart size={32} className="mb-2 opacity-50" />
        <p className="text-sm">No orders {periodLabel}</p>
      </div>
    );
  }

  const statuses = [
    { key: 'awaiting_payment', label: 'Awaiting Payment', color: 'bg-purple-500', textColor: 'text-purple-600 dark:text-purple-400' },
    { key: 'pending', label: 'Pending', color: 'bg-amber-500', textColor: 'text-amber-600 dark:text-amber-400' },
    { key: 'preparing', label: 'Preparing', color: 'bg-blue-500', textColor: 'text-blue-600 dark:text-blue-400' },
    { key: 'ready', label: 'Ready', color: 'bg-green-500', textColor: 'text-green-600 dark:text-green-400' },
    { key: 'completed', label: 'Completed', color: 'bg-gray-500', textColor: 'text-gray-600 dark:text-gray-400' },
    { key: 'cancelled', label: 'Cancelled', color: 'bg-red-500', textColor: 'text-red-600 dark:text-red-400' }
  ];

  return (
    <div>
      <div className="h-3 rounded-full overflow-hidden flex mb-4">
        {statuses.map(status => {
          const value = distribution[status.key as keyof OrderStatusDistribution];
          const percentage = (value / total) * 100;
          if (percentage === 0) return null;
          return <div key={status.key} className={`${status.color} transition-all`} style={{ width: `${percentage}%` }} title={`${status.label}: ${value} (${percentage.toFixed(0)}%)`} />;
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {statuses.map(status => {
          const value = distribution[status.key as keyof OrderStatusDistribution];
          if (value === 0) return null; // Hide statuses with 0 count
          const percentage = total > 0 ? ((value / total) * 100).toFixed(0) : 0;
          return (
            <div key={status.key} className="flex items-center gap-2 text-sm">
              <div className={`w-3 h-3 rounded-full ${status.color}`} />
              <span className="text-gray-600 dark:text-gray-400 truncate">{status.label}</span>
              <span className={`font-semibold ${status.textColor}`}>{value}</span>
              <span className="text-gray-400 dark:text-gray-500 text-xs">({percentage}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface HourlyChartProps {
  data: HourlyData[];
  dateRange: 'today' | 'week' | 'month';
}

function HourlyChart({ data, dateRange }: HourlyChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="h-40 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
        <BarChart3 size={32} className="mb-2 opacity-50" />
        <p className="text-sm">No data available</p>
      </div>
    );
  }

  const maxOrders = Math.max(...data.map(d => d.orders), 1);

  return (
    <div>
      <div className="flex items-end justify-between gap-1 h-32 mb-2">
        {data.map((hour) => {
          const heightPercent = (hour.orders / maxOrders) * 100;
          // Only highlight current hour when viewing today's data
          const isCurrentHour = dateRange === 'today' && new Date().getHours() === hour.hour;
          return (
            <div key={hour.hour} className="flex-1 flex flex-col items-center">
              <div className="w-full flex flex-col items-center">
                {hour.orders > 0 && <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">{hour.orders}</span>}
                <div className={`w-full rounded-t transition-all ${isCurrentHour ? 'bg-primary-500' : 'bg-primary-200 hover:bg-primary-300'}`} style={{ height: `${Math.max(heightPercent, 4)}%`, minHeight: hour.orders > 0 ? '8px' : '4px' }} title={`${hour.hour > 12 ? hour.hour - 12 : hour.hour}:00 ${hour.hour >= 12 ? 'PM' : 'AM'}: ${hour.orders} orders`} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
        <span>6 AM</span>
        <span>12 PM</span>
        <span>6 PM</span>
      </div>
    </div>
  );
}
