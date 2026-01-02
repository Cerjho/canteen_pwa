import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, startOfDay, startOfWeek, startOfMonth, subDays, differenceInMinutes, getHours } from 'date-fns';
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
  WifiOff
} from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { useNavigate } from 'react-router-dom';
import { playNotificationSound } from '../../utils/notificationSound';

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
  completedOrdersToday: number;
  cancelledOrdersToday: number;
  totalParents: number;
  totalChildren: number;
  totalProducts: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  avgOrderValue: number;
  avgFulfillmentTime: number;
  revenueYesterday: number;
  ordersYesterday: number;
  activeParentsToday: number;
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
  child: { first_name: string; last_name: string } | null;
  parent: { first_name: string; last_name: string } | null;
}

interface OrderStatusDistribution {
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

// ==================== MAIN COMPONENT ====================
export default function AdminDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  
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

  // Save sound preference
  useEffect(() => {
    localStorage.setItem('admin-sound-enabled', String(soundEnabled));
  }, [soundEnabled]);

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      showToast('Back online', 'success');
    };
    const handleOffline = () => {
      setIsOnline(false);
      showToast('You are offline', 'error');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [showToast]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ==================== DATA FETCHING ====================
  const { data: stats, isLoading: statsLoading, refetch: refetchStats, error: statsError } = useQuery<DashboardStats>({
    queryKey: ['admin-dashboard-stats', dateRange],
    queryFn: async () => {
      const today = startOfDay(new Date());
      const yesterday = startOfDay(subDays(new Date(), 1));
      const weekStart = startOfWeek(new Date());
      const monthStart = startOfMonth(new Date());

      // Batch queries for better performance
      const [ordersResult, parentsResult, childrenResult, productsResult] = await Promise.all([
        supabase
          .from('orders')
          .select('id, status, total_amount, created_at, updated_at, parent_id')
          .gte('created_at', monthStart.toISOString()),
        supabase
          .from('user_profiles')
          .select('*', { count: 'exact', head: true }),
        supabase
          .from('children')
          .select('*', { count: 'exact', head: true }),
        supabase
          .from('products')
          .select('id, stock_quantity, available')
      ]);

      if (ordersResult.error) throw ordersResult.error;
      
      const allOrders = ordersResult.data || [];
      const totalParents = parentsResult.count || 0;
      const totalChildren = childrenResult.count || 0;
      const products = productsResult.data || [];

      const totalProducts = products.length;
      const lowStockProducts = products.filter(p => p.stock_quantity !== null && p.stock_quantity <= 10 && p.stock_quantity > 0).length;
      const outOfStockProducts = products.filter(p => p.stock_quantity === 0 || !p.available).length;

      const todayOrders = allOrders.filter(o => new Date(o.created_at) >= today);
      const yesterdayOrders = allOrders.filter(o => {
        const date = new Date(o.created_at);
        return date >= yesterday && date < today;
      });
      const weekOrders = allOrders.filter(o => new Date(o.created_at) >= weekStart);
      const monthOrders = allOrders;

      const completedToday = todayOrders.filter(o => o.status === 'completed');
      let avgFulfillmentTime = 0;
      if (completedToday.length > 0) {
        const times = completedToday
          .filter(o => o.updated_at)
          .map(o => differenceInMinutes(new Date(o.updated_at!), new Date(o.created_at)));
        avgFulfillmentTime = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
      }

      const nonCancelledToday = todayOrders.filter(o => o.status !== 'cancelled');
      const totalRevenueToday = nonCancelledToday.reduce((sum, o) => sum + o.total_amount, 0);
      const avgOrderValue = nonCancelledToday.length > 0 ? totalRevenueToday / nonCancelledToday.length : 0;
      const activeParentsToday = new Set(todayOrders.map(o => o.parent_id)).size;

      return {
        totalOrdersToday: todayOrders.length,
        totalOrdersWeek: weekOrders.length,
        totalOrdersMonth: monthOrders.length,
        revenueToday: totalRevenueToday,
        revenueWeek: weekOrders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + o.total_amount, 0),
        revenueMonth: monthOrders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + o.total_amount, 0),
        pendingOrders: todayOrders.filter(o => o.status === 'pending').length,
        preparingOrders: todayOrders.filter(o => o.status === 'preparing').length,
        readyOrders: todayOrders.filter(o => o.status === 'ready').length,
        completedOrdersToday: completedToday.length,
        cancelledOrdersToday: todayOrders.filter(o => o.status === 'cancelled').length,
        totalParents: totalParents || 0,
        totalChildren: totalChildren || 0,
        totalProducts,
        lowStockProducts,
        outOfStockProducts,
        avgOrderValue,
        avgFulfillmentTime,
        revenueYesterday: yesterdayOrders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + o.total_amount, 0),
        ordersYesterday: yesterdayOrders.length,
        activeParentsToday
      };
    },
    refetchInterval: 10000
  });

  const { data: statusDistribution } = useQuery<OrderStatusDistribution>({
    queryKey: ['admin-status-distribution'],
    queryFn: async () => {
      const today = startOfDay(new Date());
      const { data: orders } = await supabase
        .from('orders')
        .select('status')
        .gte('created_at', today.toISOString());

      const distribution: OrderStatusDistribution = { pending: 0, preparing: 0, ready: 0, completed: 0, cancelled: 0 };
      orders?.forEach(order => {
        if (order.status in distribution) {
          distribution[order.status as keyof OrderStatusDistribution]++;
        }
      });
      return distribution;
    },
    refetchInterval: 10000
  });

  const { data: hourlyData } = useQuery<HourlyData[]>({
    queryKey: ['admin-hourly-data'],
    queryFn: async () => {
      const today = startOfDay(new Date());
      const { data: orders } = await supabase
        .from('orders')
        .select('total_amount, created_at, status')
        .gte('created_at', today.toISOString())
        .neq('status', 'cancelled');

      const hourlyMap: Record<number, HourlyData> = {};
      for (let i = 6; i <= 18; i++) {
        hourlyMap[i] = { hour: i, orders: 0, revenue: 0 };
      }

      orders?.forEach(order => {
        const hour = getHours(new Date(order.created_at));
        if (hourlyMap[hour]) {
          hourlyMap[hour].orders++;
          hourlyMap[hour].revenue += order.total_amount;
        }
      });

      return Object.values(hourlyMap).sort((a, b) => a.hour - b.hour);
    },
    refetchInterval: 30000
  });

  const { data: topProducts } = useQuery<TopProduct[]>({
    queryKey: ['admin-top-products', dateRange],
    queryFn: async () => {
      const startDate = dateRange === 'today' 
        ? startOfDay(new Date())
        : dateRange === 'week' ? startOfWeek(new Date()) : startOfMonth(new Date());

      const { data: orderItems } = await supabase
        .from('order_items')
        .select(`quantity, price_at_order, product_id, order:orders!inner(created_at, status), product:products(name, category)`)
        .gte('order.created_at', startDate.toISOString())
        .neq('order.status', 'cancelled');

      const productMap: Record<string, TopProduct> = {};
      orderItems?.forEach((item: any) => {
        const id = item.product_id;
        if (!productMap[id]) {
          productMap[id] = { product_id: id, name: item.product?.name || 'Unknown', category: item.product?.category, total_quantity: 0, total_revenue: 0 };
        }
        productMap[id].total_quantity += item.quantity;
        productMap[id].total_revenue += item.quantity * item.price_at_order;
      });

      return Object.values(productMap).sort((a, b) => b.total_revenue - a.total_revenue).slice(0, 5);
    },
    refetchInterval: 30000
  });

  const { data: recentOrders, refetch: refetchOrders } = useQuery<RecentOrder[]>({
    queryKey: ['admin-recent-orders'],
    queryFn: async () => {
      const { data } = await supabase
        .from('orders')
        .select(`id, status, total_amount, created_at, updated_at, child:students!orders_student_id_fkey(first_name, last_name), parent:user_profiles(first_name, last_name)`)
        .order('created_at', { ascending: false })
        .limit(8);
      
      // Map FK join arrays to single objects
      return (data || []).map((order: any) => ({
        ...order,
        child: Array.isArray(order.child) ? order.child[0] || null : order.child,
        parent: Array.isArray(order.parent) ? order.parent[0] || null : order.parent
      }));
    },
    refetchInterval: 5000
  });

  const { data: alerts } = useQuery<Alert[]>({
    queryKey: ['admin-alerts'],
    queryFn: async () => {
      const alertsList: Alert[] = [];

      const { data: lowStock } = await supabase
        .from('products')
        .select('name, stock_quantity')
        .lte('stock_quantity', 10)
        .gt('stock_quantity', 0)
        .eq('available', true);

      lowStock?.forEach(product => {
        alertsList.push({
          id: `low-stock-${product.name}`,
          type: 'low_stock',
          title: 'Low Stock Alert',
          message: `${product.name} has only ${product.stock_quantity} items left`,
          severity: product.stock_quantity! <= 5 ? 'error' : 'warning',
          actionLabel: 'Manage Products',
          actionRoute: '/admin/products'
        });
      });

      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const { data: oldPending } = await supabase
        .from('orders')
        .select('id')
        .eq('status', 'pending')
        .lt('created_at', tenMinutesAgo.toISOString());

      if (oldPending && oldPending.length > 0) {
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

      return alertsList.slice(0, 5);
    },
    refetchInterval: 30000
  });

  // ==================== REAL-TIME SUBSCRIPTIONS ====================
  useEffect(() => {
    if (!isOnline) return;

    const channel = supabase
      .channel('admin-dashboard-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
        // Play notification sound
        if (soundEnabled) {
          playNotificationSound(0.5);
        }
        
        // Show toast notification
        showToast('🔔 New order received!', 'info');
        
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
          preparing: '🍳 Order is being prepared',
          ready: '✅ Order is ready for pickup',
          completed: '🎉 Order completed',
          cancelled: '❌ Order was cancelled'
        };
        
        const status = payload.new.status as string;
        if (statusMessages[status]) {
          showToast(statusMessages[status], status === 'cancelled' ? 'error' : 'success');
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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'parents' }, () => {
        // Track new user registrations
        const newActivity: LiveActivity = {
          id: `user-${Date.now()}`,
          type: 'user',
          title: 'New User',
          message: 'A new parent has registered',
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
          showToast('Real-time connection lost', 'error');
        } else {
          setSystemHealth({ realtime: status === 'SUBSCRIBED' ? 'healthy' : 'degraded' });
          if (status === 'SUBSCRIBED') {
            console.log('Real-time subscription active');
          }
        }
      });

    return () => { 
      supabase.removeChannel(channel); 
    };
  }, [soundEnabled, queryClient, isOnline, showToast]);

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
      pending: 'bg-amber-100 text-amber-700 border-amber-200',
      preparing: 'bg-blue-100 text-blue-700 border-blue-200',
      ready: 'bg-green-100 text-green-700 border-green-200',
      completed: 'bg-gray-100 text-gray-700 border-gray-200',
      cancelled: 'bg-red-100 text-red-700 border-red-200'
    };
    return colors[status] || colors.pending;
  };

  const getStatusIcon = (status: string) => {
    const icons: Record<string, React.ReactNode> = {
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-500">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // ==================== ERROR STATE ====================
  if (statsError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
            <AlertTriangle size={32} className="text-red-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Failed to load dashboard</h2>
          <p className="text-gray-500 mb-4">There was an error fetching the dashboard data. Please check your connection and try again.</p>
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
    <div className="min-h-screen pb-20 bg-gray-50">
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
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Activity className="text-primary-600" />
              Admin Dashboard
            </h1>
            <p className="text-gray-500 mt-1 flex items-center gap-2">
              <Clock size={14} />
              {format(currentTime, 'EEEE, MMMM d, yyyy')} • {formatTime(currentTime)}
            </p>
          </div>
          
          <div className="flex items-center gap-2 mt-4 md:mt-0">
            {/* Connection Status */}
            <div className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border ${
              systemHealth.realtime === 'healthy' 
                ? 'bg-green-50 border-green-200' 
                : systemHealth.realtime === 'degraded'
                  ? 'bg-amber-50 border-amber-200'
                  : 'bg-red-50 border-red-200'
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
                  ? 'text-green-700' 
                  : systemHealth.realtime === 'degraded'
                    ? 'text-amber-700'
                    : 'text-red-700'
              }`}>
                {systemHealth.realtime === 'healthy' ? 'Live' : systemHealth.realtime === 'degraded' ? 'Connecting...' : 'Disconnected'}
              </span>
            </div>
            
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg transition-colors ${soundEnabled ? 'bg-primary-100 text-primary-600' : 'bg-gray-100 text-gray-500'}`}
              title={soundEnabled ? 'Mute notifications' : 'Enable notifications'}
            >
              {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            
            <button
              onClick={handleRefresh}
              disabled={isRefreshing || !isOnline}
              className="p-2 bg-white rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50"
              title="Refresh data"
            >
              <RefreshCw size={18} className={`text-gray-600 ${isRefreshing ? 'animate-spin' : ''}`} />
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
                  alert.severity === 'error' ? 'bg-red-50 border-red-200 text-red-800' 
                    : alert.severity === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-blue-50 border-blue-200 text-blue-800'
                }`}
              >
                <div className="flex items-center gap-3">
                  <AlertTriangle size={18} className="flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm">{alert.title}</p>
                    <p className="text-sm opacity-80">{alert.message}</p>
                  </div>
                </div>
                {alert.actionLabel && (
                  <button
                    onClick={() => navigate(alert.actionRoute!)}
                    className="px-3 py-1 text-sm font-medium rounded-md bg-white/50 hover:bg-white transition-colors"
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
              (stats?.pendingOrders || 0) > 0 ? 'bg-amber-50 border-amber-300 animate-pulse-subtle' : 'bg-gray-50 border-gray-200'
            }`}
            onClick={() => navigate('/admin/orders?status=pending')}
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`p-2 rounded-lg ${(stats?.pendingOrders || 0) > 0 ? 'bg-amber-200 text-amber-700' : 'bg-gray-200 text-gray-600'}`}>
                <Clock size={20} />
              </div>
              {(stats?.pendingOrders || 0) > 0 && (
                <span className="flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                </span>
              )}
            </div>
            <p className="text-3xl font-bold text-gray-900">{stats?.pendingOrders || 0}</p>
            <p className="text-sm text-gray-600">Pending Orders</p>
            {(stats?.preparingOrders || 0) > 0 && <p className="text-xs text-amber-600 mt-1">{stats?.preparingOrders} preparing</p>}
          </div>

          <div 
            className={`rounded-xl p-4 border-2 cursor-pointer transition-all hover:shadow-md ${
              (stats?.readyOrders || 0) > 0 ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-200'
            }`}
            onClick={() => navigate('/admin/orders?status=ready')}
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`p-2 rounded-lg ${(stats?.readyOrders || 0) > 0 ? 'bg-green-200 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                <CheckCircle size={20} />
              </div>
              {(stats?.readyOrders || 0) > 0 && <Bell size={16} className="text-green-600 animate-bounce" />}
            </div>
            <p className="text-3xl font-bold text-gray-900">{stats?.readyOrders || 0}</p>
            <p className="text-sm text-gray-600">Ready for Pickup</p>
            <p className="text-xs text-green-600 mt-1">{stats?.completedOrdersToday || 0} completed today</p>
          </div>

          <div className="rounded-xl p-4 bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 rounded-lg bg-white/20"><DollarSign size={20} /></div>
              <div className={`flex items-center text-xs ${revenueTrend >= 0 ? 'text-emerald-200' : 'text-red-200'}`}>
                {revenueTrend >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {Math.abs(revenueTrend).toFixed(0)}%
              </div>
            </div>
            <p className="text-3xl font-bold">P{(stats?.revenueToday || 0).toLocaleString('en-PH', { minimumFractionDigits: 0 })}</p>
            <p className="text-sm opacity-90">Revenue Today</p>
            <p className="text-xs opacity-75 mt-1">vs P{(stats?.revenueYesterday || 0).toLocaleString()} yesterday</p>
          </div>

          <div className="rounded-xl p-4 bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 rounded-lg bg-white/20"><ShoppingBag size={20} /></div>
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <StatCard title="Avg Order Value" value={`P${(stats?.avgOrderValue || 0).toFixed(0)}`} icon={Target} color="purple" />
          <StatCard title="Avg Fulfillment" value={`${Math.round(stats?.avgFulfillmentTime || 0)} min`} icon={Timer} color="indigo" subtitle={fulfillmentRate > 80 ? 'Good' : 'Needs improvement'} />
          <StatCard title="Low Stock Items" value={stats?.lowStockProducts || 0} icon={Package} color={(stats?.lowStockProducts || 0) > 0 ? 'red' : 'gray'} onClick={() => navigate('/admin/products?filter=low-stock')} clickable />
          <StatCard title="Cancelled Today" value={stats?.cancelledOrdersToday || 0} icon={XCircle} color={(stats?.cancelledOrdersToday || 0) > 0 ? 'red' : 'gray'} />
        </div>

        {/* Date Range Selector */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex gap-2 bg-white rounded-lg p-1 shadow-sm border border-gray-200">
            {(['today', 'week', 'month'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setDateRange(range)}
                className={`px-4 py-2 rounded-md font-medium text-sm transition-all ${
                  dateRange === range ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {range === 'today' ? 'Today' : range === 'week' ? 'This Week' : 'This Month'}
              </button>
            ))}
          </div>
          <div className="text-sm text-gray-500 flex items-center gap-1">
            <Calendar size={14} />
            {dateRange === 'today' && format(new Date(), 'MMM d')}
            {dateRange === 'week' && `${format(startOfWeek(new Date()), 'MMM d')} - ${format(new Date(), 'MMM d')}`}
            {dateRange === 'month' && format(new Date(), 'MMMM yyyy')}
          </div>
        </div>

        {/* Charts & Analytics Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <PieChart size={18} className="text-gray-400" />
                Order Status (Today)
              </h3>
            </div>
            <div className="p-4">
              <StatusDistributionChart distribution={statusDistribution} />
            </div>
          </div>

          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <BarChart3 size={18} className="text-gray-400" />
                Orders by Hour (Today)
              </h3>
              {peakHour && (
                <span className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-full flex items-center gap-1">
                  <Zap size={12} />
                  Peak: {peakHour.hour > 12 ? peakHour.hour - 12 : peakHour.hour}:00 {peakHour.hour >= 12 ? 'PM' : 'AM'}
                </span>
              )}
            </div>
            <div className="p-4">
              <HourlyChart data={hourlyData || []} />
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Top Products */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Award size={18} className="text-amber-500" />
                Top Products
              </h3>
              <span className="text-xs text-gray-500 capitalize">{dateRange}</span>
            </div>
            <div className="divide-y divide-gray-100">
              {topProducts?.length === 0 ? (
                <p className="p-4 text-center text-gray-500">No sales data yet</p>
              ) : (
                topProducts?.map((product, index) => (
                  <div key={product.product_id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                      index === 0 ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-300' :
                      index === 1 ? 'bg-gray-100 text-gray-700' :
                      index === 2 ? 'bg-orange-100 text-orange-700' :
                      'bg-gray-50 text-gray-500'
                    }`}>
                      {index === 0 ? <Star size={16} /> : index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{product.name}</p>
                      <p className="text-xs text-gray-500">{product.total_quantity} sold</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-green-600">P{product.total_revenue.toFixed(0)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="px-4 py-2 border-t border-gray-100">
              <button onClick={() => navigate('/admin/reports')} className="w-full text-center text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center justify-center gap-1">
                View Full Report <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {/* Recent Orders */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <ShoppingBag size={18} className="text-blue-500" />
                Recent Orders
              </h3>
              <span className="flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
            </div>
            <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
              {recentOrders?.map((order) => {
                const childName = order.child ? `${order.child.first_name} ${order.child.last_name}` : 'Unknown Student';
                return (
                  <div key={order.id} className="px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => navigate(`/admin/orders?id=${order.id}`)}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 text-sm">{childName}</p>
                        <span className="text-xs text-gray-400">#{order.id.slice(-6).toUpperCase()}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border flex items-center gap-1 ${getStatusColor(order.status)}`}>
                        {getStatusIcon(order.status)}
                        {order.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <p className="text-gray-500">{format(new Date(order.created_at), 'h:mm a')}</p>
                      <p className="font-semibold text-gray-700">P{order.total_amount.toFixed(2)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-4 py-2 border-t border-gray-100">
              <button onClick={() => navigate('/admin/orders')} className="w-full text-center text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center justify-center gap-1">
                View All Orders <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {/* Live Activity Feed */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Activity size={18} className="text-purple-500" />
                Live Activity
              </h3>
              <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                Real-time
              </span>
            </div>
            <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
              {liveActivities.length === 0 ? (
                <div className="p-8 text-center">
                  <Activity size={32} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-gray-500 text-sm">Waiting for activity...</p>
                  <p className="text-gray-400 text-xs mt-1">New orders will appear here</p>
                </div>
              ) : (
                liveActivities.map((activity) => (
                  <div key={activity.id} className="px-4 py-3 animate-slide-in">
                    <div className="flex items-start gap-3">
                      <div className={`p-1.5 rounded-full flex-shrink-0 ${
                        activity.severity === 'success' ? 'bg-green-100 text-green-600' :
                        activity.severity === 'error' ? 'bg-red-100 text-red-600' :
                        activity.severity === 'warning' ? 'bg-amber-100 text-amber-600' :
                        'bg-blue-100 text-blue-600'
                      }`}>
                        {activity.type === 'order' ? <ShoppingBag size={14} /> : activity.type === 'user' ? <Users size={14} /> : <Activity size={14} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">{activity.title}</p>
                        <p className="text-xs text-gray-500 truncate">{activity.message}</p>
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">{format(activity.timestamp, 'h:mm a')}</span>
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
          <QuickStatCard icon={<DollarSign size={18} />} label="Monthly Revenue" value={`P${((stats?.revenueMonth || 0) / 1000).toFixed(1)}k`} />
        </div>

        {/* Quick Actions */}
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Zap size={18} className="text-amber-500" />
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
    yellow: 'bg-amber-50 text-amber-600 border-amber-200',
    green: 'bg-green-50 text-green-600 border-green-200',
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    gray: 'bg-gray-50 text-gray-600 border-gray-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200',
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-200'
  };
  const iconBg: Record<string, string> = {
    yellow: 'bg-amber-100', green: 'bg-green-100', blue: 'bg-blue-100', red: 'bg-red-100', gray: 'bg-gray-100', purple: 'bg-purple-100', indigo: 'bg-indigo-100'
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
    <div className={`bg-white rounded-xl p-4 shadow-sm border border-gray-100 ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`} onClick={onClick}>
      <div className="flex items-center gap-2 text-gray-500 mb-2">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
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
    blue: 'bg-blue-50 text-blue-600 hover:bg-blue-100 border-blue-200',
    green: 'bg-green-50 text-green-600 hover:bg-green-100 border-green-200',
    purple: 'bg-purple-50 text-purple-600 hover:bg-purple-100 border-purple-200',
    amber: 'bg-amber-50 text-amber-600 hover:bg-amber-100 border-amber-200'
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
}

function StatusDistributionChart({ distribution }: StatusDistributionChartProps) {
  if (!distribution) return <div className="h-40 flex items-center justify-center text-gray-400">Loading...</div>;

  const total = Object.values(distribution).reduce((a, b) => a + b, 0);
  if (total === 0) {
    return (
      <div className="h-40 flex flex-col items-center justify-center text-gray-400">
        <PieChart size={32} className="mb-2 opacity-50" />
        <p className="text-sm">No orders today</p>
      </div>
    );
  }

  const statuses = [
    { key: 'pending', label: 'Pending', color: 'bg-amber-500', textColor: 'text-amber-600' },
    { key: 'preparing', label: 'Preparing', color: 'bg-blue-500', textColor: 'text-blue-600' },
    { key: 'ready', label: 'Ready', color: 'bg-green-500', textColor: 'text-green-600' },
    { key: 'completed', label: 'Completed', color: 'bg-gray-500', textColor: 'text-gray-600' },
    { key: 'cancelled', label: 'Cancelled', color: 'bg-red-500', textColor: 'text-red-600' }
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
          const percentage = total > 0 ? ((value / total) * 100).toFixed(0) : 0;
          return (
            <div key={status.key} className="flex items-center gap-2 text-sm">
              <div className={`w-3 h-3 rounded-full ${status.color}`} />
              <span className="text-gray-600">{status.label}</span>
              <span className={`font-semibold ${status.textColor}`}>{value}</span>
              <span className="text-gray-400 text-xs">({percentage}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface HourlyChartProps {
  data: HourlyData[];
}

function HourlyChart({ data }: HourlyChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="h-40 flex flex-col items-center justify-center text-gray-400">
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
          const isCurrentHour = new Date().getHours() === hour.hour;
          return (
            <div key={hour.hour} className="flex-1 flex flex-col items-center">
              <div className="w-full flex flex-col items-center">
                {hour.orders > 0 && <span className="text-xs text-gray-500 mb-1">{hour.orders}</span>}
                <div className={`w-full rounded-t transition-all ${isCurrentHour ? 'bg-primary-500' : 'bg-primary-200 hover:bg-primary-300'}`} style={{ height: `${Math.max(heightPercent, 4)}%`, minHeight: hour.orders > 0 ? '8px' : '4px' }} title={`${hour.hour > 12 ? hour.hour - 12 : hour.hour}:00 ${hour.hour >= 12 ? 'PM' : 'AM'}: ${hour.orders} orders`} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-gray-400">
        <span>6 AM</span>
        <span>12 PM</span>
        <span>6 PM</span>
      </div>
    </div>
  );
}
