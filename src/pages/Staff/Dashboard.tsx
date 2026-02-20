import { useState, useEffect, useMemo, useRef, useCallback, TouchEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, ChefHat, CheckCircle, RefreshCw, Bell, Volume2, VolumeX, Printer, Timer, X, Banknote, ChevronDown, ChevronRight, Users, Layers, Maximize2, Minimize2, MessageSquare, TrendingUp, AlertTriangle, BarChart3, Send, Flame } from 'lucide-react';
import { format, differenceInMinutes, isToday } from 'date-fns';
import { supabase } from '../../services/supabaseClient';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { SearchBar } from '../../components/SearchBar';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { playNotificationSound } from '../../utils/notificationSound';
import type { MealPeriod } from '../../types';
import { MEAL_PERIOD_LABELS, MEAL_PERIOD_ICONS } from '../../types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

/** Escape HTML special characters to prevent XSS in printOrder */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Helper to format date in Philippine timezone (UTC+8)
function formatDateLocal(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

type StatusFilter = 'all' | 'awaiting_payment' | 'pending' | 'preparing' | 'ready';

interface OrderItem {
  id: string;
  quantity: number;
  price_at_order: number;
  product: {
    name: string;
    image_url: string;
    category: string;
  };
}

interface StaffOrder {
  id: string;
  status: string;
  payment_status: string;
  payment_due_at: string | null;
  total_amount: number;
  created_at: string;
  scheduled_for: string;
  meal_period?: MealPeriod;
  notes?: string;
  staff_notes?: string;
  payment_method: string;
  completed_at?: string;
  child: {
    first_name: string;
    last_name: string;
    grade_level: string;
    section: string;
  };
  parent: {
    first_name: string;
    last_name: string;
    phone_number?: string;
  };
  items: OrderItem[];
}

// Peak hour detection thresholds
const PEAK_HOUR_THRESHOLD = 10; // Orders per hour to consider "peak"
const RUSH_THRESHOLD = 15; // Orders per hour to consider "rush"

// Swipe detection configuration
const SWIPE_THRESHOLD = 100; // Minimum swipe distance in pixels
const SWIPE_VELOCITY_THRESHOLD = 0.5; // Minimum velocity for swipe

// Calculate wait time category
function getWaitTimeCategory(createdAt: string): { minutes: number; category: 'normal' | 'warning' | 'critical' } {
  const minutes = differenceInMinutes(new Date(), new Date(createdAt));
  if (minutes >= 15) return { minutes, category: 'critical' };
  if (minutes >= 10) return { minutes, category: 'warning' };
  return { minutes, category: 'normal' };
}

// Grade level sorting order (K-12 Philippine Education System)
const GRADE_ORDER: Record<string, number> = {
  'nursery': 0,
  'kinder': 1,
  'kindergarten': 1,
  'grade 1': 2,
  'grade 2': 3,
  'grade 3': 4,
  'grade 4': 5,
  'grade 5': 6,
  'grade 6': 7,
  'grade 7': 8,
  'grade 8': 9,
  'grade 9': 10,
  'grade 10': 11,
  'grade 11': 12,
  'grade 12': 13,
};

// Get normalized grade level for sorting
function getGradeOrder(gradeLevel: string): number {
  const normalized = gradeLevel?.toLowerCase().trim() || '';
  // Check exact match first
  if (GRADE_ORDER[normalized] !== undefined) {
    return GRADE_ORDER[normalized];
  }
  // Extract number if present (e.g., "G1", "Gr. 1", "1st Grade")
  const match = normalized.match(/\d+/);
  if (match) {
    const num = parseInt(match[0], 10);
    if (num >= 1 && num <= 12) return num + 1; // +1 to account for nursery/kinder
  }
  return 999; // Unknown grades go last
}

// Group orders by grade level
interface GradeGroup {
  gradeLevel: string;
  orders: StaffOrder[];
  orderCount: number;
  pendingCount: number;
  preparingCount: number;
  readyCount: number;
  awaitingPaymentCount: number;
}

function groupOrdersByGrade(orders: StaffOrder[]): GradeGroup[] {
  const groups = new Map<string, StaffOrder[]>();
  
  orders.forEach(order => {
    const gradeLevel = order.child?.grade_level || 'Unknown';
    const existing = groups.get(gradeLevel);
    if (existing) {
      existing.push(order);
    } else {
      groups.set(gradeLevel, [order]);
    }
  });
  
  // Convert to array and sort by grade order
  const result: GradeGroup[] = Array.from(groups.entries())
    .map(([gradeLevel, gradeOrders]) => ({
      gradeLevel,
      orders: gradeOrders,
      orderCount: gradeOrders.length,
      pendingCount: gradeOrders.filter(o => o.status === 'pending').length,
      preparingCount: gradeOrders.filter(o => o.status === 'preparing').length,
      readyCount: gradeOrders.filter(o => o.status === 'ready').length,
      awaitingPaymentCount: gradeOrders.filter(o => o.status === 'awaiting_payment').length,
    }))
    .sort((a, b) => getGradeOrder(a.gradeLevel) - getGradeOrder(b.gradeLevel));
  
  return result;
}

type DateFilter = 'today' | 'future' | 'all';
type ViewMode = 'flat' | 'grouped' | 'kitchen';

// Meal period ordering for kitchen prep view
const MEAL_PERIOD_ORDER: MealPeriod[] = ['morning_snack', 'lunch', 'afternoon_snack'];

interface PrepItem {
  name: string;
  quantity: number;
  image_url: string;
  pendingQty: number;
  preparingQty: number;
}

// Touch tracking for swipe gestures
interface TouchState {
  startX: number;
  startY: number;
  startTime: number;
  orderId: string;
}

export default function StaffDashboard() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('today');
  const [searchQuery, setSearchQuery] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showCancelDialog, setShowCancelDialog] = useState<string | null>(null);
  const [showPaymentDialog, setShowPaymentDialog] = useState<string | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('grouped');
  const [collapsedGrades, setCollapsedGrades] = useState<Set<string>>(new Set());
  
  // New feature states
  const [isKitchenFullscreen, setIsKitchenFullscreen] = useState(false);
  const [staffNoteInput, setStaffNoteInput] = useState<{ orderId: string; note: string } | null>(null);
  const [localStaffNotes, setLocalStaffNotes] = useState<Record<string, string[]>>({});
  const [showStatsPanel, setShowStatsPanel] = useState(false);
  const [swipingOrder, setSwipingOrder] = useState<string | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const touchState = useRef<TouchState | null>(null);
  const [, setTimerTick] = useState(0); // Force re-render for countdown timers
  const previousOrderCount = useRef<number>(0);
  const { showToast } = useToast();

  const { data: orders, isLoading, refetch } = useQuery<StaffOrder[]>({
    queryKey: ['staff-orders', dateFilter], // Remove statusFilter from query key
    queryFn: async () => {
      const todayStr = formatDateLocal(new Date());
      let query = supabase
        .from('orders')
        .select(`
          *,
          child:students!orders_student_id_fkey(first_name, last_name, grade_level, section),
          parent:user_profiles(first_name, last_name, phone_number),
          items:order_items(
            *,
            product:products(name, image_url, category)
          )
        `)
        .order('scheduled_for', { ascending: true })
        .order('created_at', { ascending: true });
      
      // Apply date filter
      if (dateFilter === 'today') {
        query = query.eq('scheduled_for', todayStr);
      } else if (dateFilter === 'future') {
        query = query.gt('scheduled_for', todayStr);
      }
      // 'all' - no date filter, show all orders
      
      // Always fetch all active statuses - filter in frontend for accurate counts
      query = query.in('status', ['awaiting_payment', 'pending', 'preparing', 'ready']);
      
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 10000 // Refetch every 10 seconds (faster for payment updates)
  });

  // Separate query for completed orders today (needed for stats panel)
  const { data: completedOrdersToday } = useQuery<StaffOrder[]>({
    queryKey: ['staff-completed-orders-today'],
    queryFn: async () => {
      const todayStr = formatDateLocal(new Date());
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          child:students!orders_student_id_fkey(first_name, last_name, grade_level, section),
          parent:user_profiles(first_name, last_name, phone_number),
          items:order_items(
            *,
            product:products(name, image_url, category)
          )
        `)
        .eq('scheduled_for', todayStr)
        .eq('status', 'completed')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000 // Refetch every 30 seconds (less urgent)
  });

  // Filter orders by search query AND status filter
  const filteredOrders = useMemo(() => {
    if (!orders) return [];
    
    // First filter by status
    let result = orders;
    if (statusFilter !== 'all') {
      result = result.filter(order => order.status === statusFilter);
    }
    
    // Then filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(order => 
        `${order.child?.first_name || ''} ${order.child?.last_name || ''}`.toLowerCase().includes(query) ||
        `${order.child?.grade_level || ''} ${order.child?.section || ''}`.toLowerCase().includes(query) ||
        order.items.some(item => item.product.name.toLowerCase().includes(query))
      );
    }
    
    // Sort by urgency: critical wait time first, then by created_at
    result = [...result].sort((a, b) => {
      const aWait = differenceInMinutes(new Date(), new Date(a.created_at));
      const bWait = differenceInMinutes(new Date(), new Date(b.created_at));
      const aUrgent = aWait >= 10 && a.status === 'pending';
      const bUrgent = bWait >= 10 && b.status === 'pending';
      
      // Urgent orders first
      if (aUrgent && !bUrgent) return -1;
      if (!aUrgent && bUrgent) return 1;
      
      // Then awaiting payment (time-sensitive)
      if (a.status === 'awaiting_payment' && b.status !== 'awaiting_payment') return -1;
      if (b.status === 'awaiting_payment' && a.status !== 'awaiting_payment') return 1;
      
      // Then by wait time (longest first)
      return bWait - aWait;
    });
    
    return result;
  }, [orders, statusFilter, searchQuery]);

  // Group filtered orders by grade level
  const groupedOrders = useMemo(() => {
    return groupOrdersByGrade(filteredOrders);
  }, [filteredOrders]);

  // Toggle grade group collapse/expand
  const toggleGradeCollapse = useCallback((gradeLevel: string) => {
    setCollapsedGrades(prev => {
      const newSet = new Set(prev);
      if (newSet.has(gradeLevel)) {
        newSet.delete(gradeLevel);
      } else {
        newSet.add(gradeLevel);
      }
      return newSet;
    });
  }, []);

  // Expand/collapse all grades
  const expandAllGrades = useCallback(() => {
    setCollapsedGrades(new Set());
  }, []);

  const collapseAllGrades = useCallback(() => {
    const allGrades = new Set(groupedOrders.map(g => g.gradeLevel));
    setCollapsedGrades(allGrades);
  }, [groupedOrders]);

  // Select all orders in a grade (excluding awaiting_payment)
  const toggleSelectAllInGrade = useCallback((gradeLevel: string) => {
    const gradeGroup = groupedOrders.find(g => g.gradeLevel === gradeLevel);
    if (!gradeGroup) return;
    
    // Get selectable orders (not awaiting_payment)
    const selectableOrderIds = gradeGroup.orders
      .filter(o => o.status !== 'awaiting_payment')
      .map(o => o.id);
    
    // Check if all are already selected
    const allSelected = selectableOrderIds.every(id => selectedOrders.includes(id));
    
    if (allSelected) {
      // Deselect all in this grade
      setSelectedOrders(prev => prev.filter(id => !selectableOrderIds.includes(id)));
    } else {
      // Select all in this grade
      setSelectedOrders(prev => [...new Set([...prev, ...selectableOrderIds])]);
    }
  }, [groupedOrders, selectedOrders]);

  // Check if all orders in a grade are selected
  const isGradeFullySelected = useCallback((gradeLevel: string) => {
    const gradeGroup = groupedOrders.find(g => g.gradeLevel === gradeLevel);
    if (!gradeGroup) return false;
    
    const selectableOrderIds = gradeGroup.orders
      .filter(o => o.status !== 'awaiting_payment')
      .map(o => o.id);
    
    if (selectableOrderIds.length === 0) return false;
    return selectableOrderIds.every(id => selectedOrders.includes(id));
  }, [groupedOrders, selectedOrders]);

  // Calculate counts from ALL orders (not filtered by status) - memoized
  const statusCounts = useMemo(() => ({
    awaitingPayment: orders?.filter(o => o.status === 'awaiting_payment').length || 0,
    pending: orders?.filter(o => o.status === 'pending').length || 0,
    preparing: orders?.filter(o => o.status === 'preparing').length || 0,
    ready: orders?.filter(o => o.status === 'ready').length || 0,
    total: orders?.length || 0,
  }), [orders]);

  // Kitchen prep grouped by GRADE first, then meal period within each grade
  // Layout: Grade 1 → Morning: Turon 2, Banana Cue 3 | Lunch: Beef Tapa 3 | Afternoon: Turon 5
  interface GradeMealPrepGroup {
    gradeLevel: string;
    meals: {
      mealPeriod: MealPeriod;
      items: PrepItem[];
      totalItems: number;
    }[];
    totalItems: number;
  }

  const prepByGrade = useMemo((): GradeMealPrepGroup[] => {
    if (!orders) return [];

    // Build nested map: grade_level → meal_period → product_name → PrepItem
    const gradeMap = new Map<string, Map<MealPeriod, Map<string, PrepItem>>>();

    orders
      .filter(o => o.status === 'pending' || o.status === 'preparing')
      .forEach(order => {
        const gradeLevel = order.child?.grade_level || 'Unknown';
        const mealPeriod: MealPeriod = order.meal_period || 'lunch';

        if (!gradeMap.has(gradeLevel)) gradeMap.set(gradeLevel, new Map());
        const mealMap = gradeMap.get(gradeLevel)!;

        if (!mealMap.has(mealPeriod)) mealMap.set(mealPeriod, new Map());
        const itemMap = mealMap.get(mealPeriod)!;

        order.items.forEach(item => {
          const existing = itemMap.get(item.product.name);
          if (existing) {
            existing.quantity += item.quantity;
            if (order.status === 'pending') existing.pendingQty += item.quantity;
            else existing.preparingQty += item.quantity;
          } else {
            itemMap.set(item.product.name, {
              name: item.product.name,
              quantity: item.quantity,
              image_url: item.product.image_url,
              pendingQty: order.status === 'pending' ? item.quantity : 0,
              preparingQty: order.status === 'preparing' ? item.quantity : 0,
            });
          }
        });
      });

    // Convert to sorted arrays: grades sorted by K-12 order, meals in period order
    return Array.from(gradeMap.entries())
      .map(([gradeLevel, mealMap]) => {
        const meals = MEAL_PERIOD_ORDER
          .filter(mp => mealMap.has(mp))
          .map(mp => {
            const items = Array.from(mealMap.get(mp)!.values()).sort((a, b) => b.quantity - a.quantity);
            return {
              mealPeriod: mp,
              items,
              totalItems: items.reduce((sum, i) => sum + i.quantity, 0),
            };
          });

        return {
          gradeLevel,
          meals,
          totalItems: meals.reduce((sum, m) => sum + m.totalItems, 0),
        };
      })
      .sort((a, b) => getGradeOrder(a.gradeLevel) - getGradeOrder(b.gradeLevel));
  }, [orders]);

  // Flat itemsToPrep kept for total count in the header badge
  const itemsToPrep = useMemo(() => {
    return prepByGrade.reduce((sum, g) => sum + g.totalItems, 0);
  }, [prepByGrade]);

  // Peak hour detection - calculate orders per hour
  const peakHourStatus = useMemo(() => {
    if (!orders) return { isPeak: false, isRush: false, ordersPerHour: 0, trend: 'stable' as const };
    
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    
    // Count orders in last hour
    const recentOrders = orders.filter(o => new Date(o.created_at) >= oneHourAgo);
    const previousHourOrders = orders.filter(o => {
      const orderTime = new Date(o.created_at);
      return orderTime >= twoHoursAgo && orderTime < oneHourAgo;
    });
    
    const ordersPerHour = recentOrders.length;
    const previousOrdersPerHour = previousHourOrders.length;
    
    // Determine trend
    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (ordersPerHour > previousOrdersPerHour * 1.2) trend = 'increasing';
    else if (ordersPerHour < previousOrdersPerHour * 0.8) trend = 'decreasing';
    
    return {
      isPeak: ordersPerHour >= PEAK_HOUR_THRESHOLD,
      isRush: ordersPerHour >= RUSH_THRESHOLD,
      ordersPerHour,
      trend,
    };
  }, [orders]);

  // Order completion stats
  const orderStats = useMemo(() => {
    if (!orders) return null;
    
    // Active orders from the main query (today's active)
    const todayActiveOrders = orders.filter(o => isToday(new Date(o.created_at)));
    // Completed orders from the separate query
    const completedToday = completedOrdersToday || [];
    
    // Total today = active + completed
    const totalTodayOrders = todayActiveOrders.length + completedToday.length;
    
    // Average preparation time (from pending to completed)
    const prepTimes: number[] = [];
    completedToday.forEach(order => {
      if (order.completed_at) {
        const prepTime = differenceInMinutes(new Date(order.completed_at), new Date(order.created_at));
        if (prepTime > 0 && prepTime < 120) { // Filter outliers
          prepTimes.push(prepTime);
        }
      }
    });
    
    const avgPrepTime = prepTimes.length > 0 
      ? Math.round(prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length)
      : 0;
    
    // Revenue
    const totalRevenue = completedToday.reduce((sum, o) => sum + o.total_amount, 0);
    
    // Orders by status
    const pendingTooLong = todayActiveOrders.filter(o => 
      o.status === 'pending' && differenceInMinutes(new Date(), new Date(o.created_at)) > 15
    ).length;
    
    return {
      totalOrders: totalTodayOrders,
      completedOrders: completedToday.length,
      avgPrepTime,
      totalRevenue,
      pendingTooLong,
      completionRate: totalTodayOrders > 0 
        ? Math.round((completedToday.length / totalTodayOrders) * 100)
        : 0,
    };
  }, [orders, completedOrdersToday]);

  // Swipe gesture handlers
  const handleTouchStart = useCallback((e: TouchEvent<HTMLDivElement>, orderId: string, status: string) => {
    // Only allow swipe for pending/preparing orders
    if (status === 'awaiting_payment' || status === 'completed') return;
    
    const touch = e.touches[0];
    touchState.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
      orderId,
    };
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent<HTMLDivElement>) => {
    if (!touchState.current) return;
    
    const touch = e.touches[0];
    const deltaX = touch.clientX - touchState.current.startX;
    const deltaY = touch.clientY - touchState.current.startY;
    
    // Only horizontal swipe
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      e.preventDefault();
      setSwipingOrder(touchState.current.orderId);
      setSwipeOffset(Math.max(-100, Math.min(100, deltaX)));
    }
  }, []);

  const handleTouchEnd = useCallback((order: StaffOrder) => {
    if (!touchState.current || !swipingOrder) {
      touchState.current = null;
      return;
    }
    
    const deltaX = swipeOffset;
    const elapsed = Date.now() - touchState.current.startTime;
    const velocity = Math.abs(deltaX) / elapsed;
    
    // Check if swipe meets threshold
    if (Math.abs(deltaX) > SWIPE_THRESHOLD || velocity > SWIPE_VELOCITY_THRESHOLD) {
      if (deltaX > 0) {
        // Swipe right - advance status
        if (order.status === 'pending') {
          updateOrderStatus(order.id, 'preparing');
          showToast('📋 Order marked as preparing', 'success');
        } else if (order.status === 'preparing') {
          updateOrderStatus(order.id, 'ready');
          showToast('✅ Order marked as ready', 'success');
        } else if (order.status === 'ready') {
          updateOrderStatus(order.id, 'completed');
          showToast('🎉 Order completed!', 'success');
        }
      } else {
        // Swipe left - show cancel dialog
        if (order.status === 'pending') {
          setShowCancelDialog(order.id);
        }
      }
    }
    
    touchState.current = null;
    setSwipingOrder(null);
    setSwipeOffset(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swipingOrder, swipeOffset, showToast]);

  // Staff note handler
  const addStaffNote = useCallback((orderId: string, note: string) => {
    if (!note.trim()) return;
    
    setLocalStaffNotes(prev => ({
      ...prev,
      [orderId]: [...(prev[orderId] || []), `${format(new Date(), 'h:mm a')}: ${note}`]
    }));
    setStaffNoteInput(null);
    showToast('📝 Note added', 'success');
  }, [showToast]);

  // Track last refresh time for indicator
  const [lastRefreshTime, setLastRefreshTime] = useState<Date>(new Date());
  
  // Update last refresh time when orders change
  useEffect(() => {
    if (orders) {
      setLastRefreshTime(new Date());
    }
  }, [orders]);

  // Realtime subscription for new orders
  useEffect(() => {
    const channel = supabase
      .channel('staff-orders')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        () => {
          refetch();
          // Play notification sound for new orders
          if (soundEnabled) {
            playNotificationSound(0.5);
          }
          showToast('🔔 New order received!', 'info');
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        () => {
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetch, showToast, soundEnabled]);

  // Track order count for notifications (sound already played by realtime INSERT handler)
  useEffect(() => {
    previousOrderCount.current = orders?.length || 0;
  }, [orders]);

  // Real-time countdown timer for payment deadlines
  useEffect(() => {
    // Check if there are any awaiting_payment orders
    const hasAwaitingPayment = orders?.some(o => o.status === 'awaiting_payment' && o.payment_due_at);
    
    if (!hasAwaitingPayment) return;
    
    // Update every second for real-time countdown
    const interval = setInterval(() => {
      setTimerTick(t => t + 1);
      
      // Check if any order just expired
      orders?.forEach(order => {
        if (order.status === 'awaiting_payment' && order.payment_due_at) {
          const due = new Date(order.payment_due_at);
          const now = new Date();
          const diffMs = due.getTime() - now.getTime();
          
          // Just expired (within last second)
          if (diffMs <= 0 && diffMs > -1000) {
            showToast(`⏰ Payment for ${order.child?.first_name}'s order has expired`, 'error');
            refetch(); // Refresh to get updated status
          }
        }
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [orders, showToast, refetch]);

  // Confirm cash payment
  const confirmCashPayment = async (orderId: string) => {
    try {
      // First check if the order's payment has expired
      const order = orders?.find(o => o.id === orderId);
      if (order && isPaymentExpired(order.payment_due_at, order.payment_status)) {
        showToast('Cannot confirm payment - deadline has passed. Order will be cancelled.', 'error');
        setShowPaymentDialog(null);
        refetch();
        return;
      }
      
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        showToast('Please log in again', 'error');
        return;
      }

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/confirm-cash-payment`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ order_id: orderId }),
        }
      );

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.message || 'Failed to confirm payment');
      }

      showToast('Cash payment confirmed! Order is now pending.', 'success');
      setShowPaymentDialog(null);
      refetch();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to confirm payment', 'error');
    }
  };

  const updateOrderStatus = async (orderId: string, status: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        showToast('Please log in again', 'error');
        return;
      }

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/manage-order`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'update-status',
            order_id: orderId,
            status
          }),
        }
      );

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.message || 'Failed to update order');
      }

      showToast(`Order marked as ${status}`, 'success');
      setSelectedOrders(prev => prev.filter(id => id !== orderId));
      refetch();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to update order', 'error');
    }
  };

  const handleBatchStatusUpdate = useCallback(async (status: string) => {
    if (selectedOrders.length === 0) return;
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        showToast('Please log in again', 'error');
        return;
      }

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/manage-order`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'bulk-update-status',
            order_ids: selectedOrders,
            status
          }),
        }
      );

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.message || 'Failed to update orders');
      }

      showToast(`${result.updated_count || selectedOrders.length} orders marked as ${status}`, 'success');
      setSelectedOrders([]);
      refetch();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to update orders', 'error');
    }
  }, [selectedOrders, refetch, showToast]);

  const handleCancelOrder = async (orderId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        showToast('Please log in again', 'error');
        return;
      }

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/manage-order`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'cancel',
            order_id: orderId,
            reason: 'Cancelled by staff'
          }),
        }
      );

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.message || 'Failed to cancel order');
      }

      showToast('Order cancelled', 'success');
      setShowCancelDialog(null);
      refetch();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to cancel order', 'error');
    }
  };

  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrders(prev => 
      prev.includes(orderId) 
        ? prev.filter(id => id !== orderId)
        : [...prev, orderId]
    );
  };

  // Enhanced thermal printer support (ESC/POS compatible styling)
  const printOrder = (order: StaffOrder, thermal: boolean = false) => {
    const staffNotes = localStaffNotes[order.id] || [];
    
    // Thermal printer optimized CSS (80mm width ~48 chars)
    const thermalStyle = `
      @page { size: 80mm auto; margin: 0; }
      @media print { body { width: 80mm; margin: 0; padding: 5mm; } }
      * { margin: 0; padding: 0; font-family: 'Courier New', monospace; }
      body { width: 80mm; padding: 5mm; font-size: 12px; line-height: 1.4; }
      .header { text-align: center; margin-bottom: 8px; border-bottom: 2px dashed #000; padding-bottom: 8px; }
      .order-num { font-size: 24px; font-weight: bold; letter-spacing: 2px; }
      .student { font-size: 16px; font-weight: bold; margin: 8px 0; text-align: center; }
      .class { text-align: center; font-size: 14px; margin-bottom: 8px; }
      .divider { border-top: 1px dashed #000; margin: 8px 0; }
      .item { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; }
      .item-qty { font-weight: bold; min-width: 30px; }
      .total { font-size: 18px; font-weight: bold; text-align: right; margin-top: 8px; border-top: 2px dashed #000; padding-top: 8px; }
      .notes { background: #f0f0f0; padding: 8px; margin: 8px 0; font-size: 11px; }
      .staff-notes { border-left: 3px solid #000; padding-left: 8px; margin: 8px 0; font-size: 10px; }
      .footer { text-align: center; margin-top: 10px; font-size: 10px; color: #666; }
      .time { font-size: 11px; text-align: center; }
    `;
    
    const standardStyle = `
      body { font-family: Arial, sans-serif; padding: 20px; max-width: 400px; margin: 0 auto; }
      .header { text-align: center; margin-bottom: 15px; }
      .order-num { font-size: 28px; font-weight: bold; background: #000; color: #fff; padding: 10px 20px; display: inline-block; }
      .student { font-size: 20px; font-weight: bold; margin: 15px 0 5px; text-align: center; }
      .class { text-align: center; color: #666; margin-bottom: 15px; }
      .divider { border-top: 2px dashed #ccc; margin: 15px 0; }
      .item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
      .item-name { flex: 1; }
      .item-qty { font-weight: bold; background: #f0f0f0; padding: 2px 8px; border-radius: 4px; }
      .total { font-size: 22px; font-weight: bold; text-align: right; margin-top: 15px; padding-top: 15px; border-top: 2px solid #000; }
      .notes { background: #fff3cd; padding: 12px; margin: 15px 0; border-radius: 8px; border-left: 4px solid #ffc107; }
      .staff-notes { background: #e7f3ff; padding: 12px; margin: 15px 0; border-radius: 8px; border-left: 4px solid #0066cc; }
      .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #999; }
      .time { font-size: 12px; color: #666; text-align: center; }
    `;
    
    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Order #${order.id.slice(-4).toUpperCase()}</title>
          <style>${thermal ? thermalStyle : standardStyle}</style>
        </head>
        <body>
          <div class="header">
            <div class="order-num">#${order.id.slice(-4).toUpperCase()}</div>
          </div>
          
          <div class="student">${escapeHtml(order.child?.first_name || 'Unknown')} ${escapeHtml(order.child?.last_name || 'Student')}</div>
          <div class="class">${escapeHtml(order.child?.grade_level || '-')} - ${escapeHtml(order.child?.section || '-')}</div>
          <div class="time">Ordered: ${format(new Date(order.created_at), 'h:mm a')} | ${format(new Date(order.created_at), 'MMM d')}</div>
          
          <div class="divider"></div>
          
          ${order.items.map(item => `
            <div class="item">
              <span class="item-name">${escapeHtml(item.product.name)}</span>
              <span class="item-qty">×${item.quantity}</span>
            </div>
          `).join('')}
          
          <div class="total">TOTAL: ₱${order.total_amount.toFixed(2)}</div>
          
          ${order.notes ? `<div class="notes">📝 Customer: ${escapeHtml(order.notes)}</div>` : ''}
          
          ${staffNotes.length > 0 ? `
            <div class="staff-notes">
              <strong>Staff Notes:</strong><br/>
              ${staffNotes.map(n => escapeHtml(n)).join('<br/>')}
            </div>
          ` : ''}
          
          <div class="footer">
            Payment: ${order.payment_method?.toUpperCase() || 'N/A'}<br/>
            ${thermal ? '--- CANTEEN ORDER ---' : 'Thank you!'}
          </div>
        </body>
      </html>
    `;
    
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.print();
    }
  };

  // Keyboard shortcuts for power users
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Only handle if not typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      // Handle shortcuts for selected orders
      if (selectedOrders.length > 0) {
        switch (e.key.toLowerCase()) {
          case 'p':
            e.preventDefault();
            handleBatchStatusUpdate('preparing');
            break;
          case 'r':
            e.preventDefault();
            handleBatchStatusUpdate('ready');
            break;
          case 'escape':
            e.preventDefault();
            setSelectedOrders([]);
            break;
        }
      }
      
      // Global shortcuts
      switch (e.key.toLowerCase()) {
        case 'f':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            // Focus search input
            document.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
          }
          break;
        case '1':
          if (e.altKey) {
            e.preventDefault();
            setStatusFilter('all');
          }
          break;
        case '2':
          if (e.altKey) {
            e.preventDefault();
            setStatusFilter('pending');
          }
          break;
        case '3':
          if (e.altKey) {
            e.preventDefault();
            setStatusFilter('preparing');
          }
          break;
        case '4':
          if (e.altKey) {
            e.preventDefault();
            setStatusFilter('ready');
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [selectedOrders, handleBatchStatusUpdate]);

  const getStatusBadge = (status: string, paymentStatus?: string) => {
    // Show awaiting payment status differently
    if (status === 'awaiting_payment' || paymentStatus === 'awaiting_payment') {
      return 'bg-orange-200 dark:bg-orange-900/50 text-orange-800 dark:text-orange-300';
    }
    const styles: Record<string, string> = {
      pending: 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
      preparing: 'bg-yellow-200 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300',
      ready: 'bg-green-200 dark:bg-green-900/50 text-green-800 dark:text-green-300',
      completed: 'bg-blue-200 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300'
    };
    return styles[status] || styles.pending;
  };

  const getStatusIcon = (status: string, paymentStatus?: string) => {
    if (status === 'awaiting_payment' || paymentStatus === 'awaiting_payment') {
      return <Banknote size={16} />;
    }
    switch (status) {
      case 'pending': return <Clock size={16} />;
      case 'preparing': return <ChefHat size={16} />;
      case 'ready': return <Bell size={16} />;
      case 'completed': return <CheckCircle size={16} />;
      default: return <Clock size={16} />;
    }
  };

  // Calculate time remaining for cash payment
  const getPaymentTimeRemaining = (paymentDueAt: string | null) => {
    if (!paymentDueAt) return null;
    const due = new Date(paymentDueAt);
    const now = new Date();
    const diffMs = due.getTime() - now.getTime();
    if (diffMs <= 0) return 'Expired';
    const mins = Math.floor(diffMs / 60000);
    const secs = Math.floor((diffMs % 60000) / 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  // Check if payment is expired
  const isPaymentExpired = (paymentDueAt: string | null, paymentStatus?: string) => {
    if (paymentStatus === 'timeout') return true;
    if (!paymentDueAt) return false;
    const due = new Date(paymentDueAt);
    return due.getTime() < Date.now();
  };

  const getWaitTimeColor = (category: 'normal' | 'warning' | 'critical') => {
    switch (category) {
      case 'critical': return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30';
      case 'warning': return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30';
      default: return 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700';
    }
  };

  const getSubtitle = () => {
    switch (dateFilter) {
      case 'today': return "Today's orders";
      case 'future': return 'Upcoming scheduled orders';
      case 'all': return 'All orders';
    }
  };

  // Kitchen Display Mode - Fullscreen view
  if (viewMode === 'kitchen' && isKitchenFullscreen) {
    return (
      <div className="fixed inset-0 bg-gray-900 text-white z-50 overflow-auto">
        <div className="p-4">
          {/* Kitchen Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <h1 className="text-3xl font-bold">🍳 Kitchen Display</h1>
              {peakHourStatus.isRush && (
                <span className="animate-pulse flex items-center gap-2 px-4 py-2 bg-red-600 rounded-lg text-lg font-bold">
                  <Flame size={24} /> RUSH HOUR!
                </span>
              )}
              {peakHourStatus.isPeak && !peakHourStatus.isRush && (
                <span className="flex items-center gap-2 px-4 py-2 bg-orange-600 rounded-lg text-lg font-bold">
                  <AlertTriangle size={24} /> Peak Time
                </span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <span className="text-2xl">{format(new Date(), 'h:mm a')}</span>
              <button
                onClick={() => setIsKitchenFullscreen(false)}
                className="p-3 bg-gray-700 hover:bg-gray-600 rounded-lg"
              >
                <Minimize2 size={24} />
              </button>
            </div>
          </div>

          {/* Status Summary */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-orange-600/30 border-2 border-orange-500 rounded-xl p-4 text-center">
              <div className="text-5xl font-bold">{statusCounts.awaitingPayment}</div>
              <div className="text-lg mt-1">Awaiting Pay</div>
            </div>
            <div className="bg-gray-600/30 border-2 border-gray-500 rounded-xl p-4 text-center">
              <div className="text-5xl font-bold">{statusCounts.pending}</div>
              <div className="text-lg mt-1">Pending</div>
            </div>
            <div className="bg-yellow-600/30 border-2 border-yellow-500 rounded-xl p-4 text-center">
              <div className="text-5xl font-bold">{statusCounts.preparing}</div>
              <div className="text-lg mt-1">Preparing</div>
            </div>
            <div className="bg-green-600/30 border-2 border-green-500 rounded-xl p-4 text-center">
              <div className="text-5xl font-bold">{statusCounts.ready}</div>
              <div className="text-lg mt-1">Ready</div>
            </div>
          </div>

          {/* Items to Prep - Grouped by Grade, then Meal Period inline */}
          <div className="mb-6">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <ChefHat size={24} /> Items to Prepare
              <span className="text-sm font-normal text-gray-400">({itemsToPrep} total)</span>
            </h2>
            {prepByGrade.length === 0 ? (
              <div className="text-center text-gray-500 py-8 text-lg">No items to prepare right now</div>
            ) : (
              <div className="space-y-4">
                {prepByGrade.map((gradeGroup) => (
                  <div 
                    key={gradeGroup.gradeLevel}
                    className="bg-gray-800/80 rounded-xl border border-gray-700 overflow-hidden"
                  >
                    {/* Grade Header */}
                    <div className="flex items-center gap-3 px-5 py-3 bg-gray-700/50 border-b border-gray-700">
                      <Users size={20} className="text-blue-400" />
                      <span className="text-lg font-bold">{gradeGroup.gradeLevel}</span>
                      <span className="text-sm text-gray-400">({gradeGroup.totalItems} items)</span>
                    </div>

                    {/* Meal Period Rows */}
                    <div className="divide-y divide-gray-700/50">
                      {gradeGroup.meals.map((meal) => (
                        <div key={`${gradeGroup.gradeLevel}-${meal.mealPeriod}`} className="px-5 py-3">
                          <div className="flex items-start gap-3">
                            {/* Meal label */}
                            <div className="flex items-center gap-2 min-w-[140px] pt-0.5">
                              <span className="text-lg">{MEAL_PERIOD_ICONS[meal.mealPeriod]}</span>
                              <span className="text-sm font-semibold text-gray-300">{MEAL_PERIOD_LABELS[meal.mealPeriod]}</span>
                            </div>
                            {/* Items inline */}
                            <div className="flex flex-wrap gap-2 flex-1">
                              {meal.items.map((item) => (
                                <div 
                                  key={item.name}
                                  className="inline-flex items-center gap-2 bg-gray-700/80 rounded-lg px-3 py-2 border border-gray-600"
                                >
                                  <span className="text-xl font-bold text-yellow-400">{item.quantity}×</span>
                                  <span className="text-sm">{item.name}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Active Orders Grid - Large Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredOrders.filter(o => o.status !== 'completed').slice(0, 20).map((order) => {
              const waitTime = getWaitTimeCategory(order.created_at);
              return (
                <div 
                  key={order.id}
                  className={`rounded-xl p-4 border-4 ${
                    order.status === 'ready' 
                      ? 'bg-green-900/50 border-green-500' 
                      : order.status === 'preparing'
                      ? 'bg-yellow-900/50 border-yellow-500'
                      : order.status === 'awaiting_payment'
                      ? 'bg-orange-900/50 border-orange-500'
                      : waitTime.category === 'critical'
                      ? 'bg-red-900/50 border-red-500 animate-pulse'
                      : 'bg-gray-800 border-gray-600'
                  }`}
                >
                  <div className="text-3xl font-mono font-bold text-center mb-2">
                    #{order.id.slice(-4).toUpperCase()}
                  </div>
                  <div className="text-xl font-bold text-center mb-1">
                    {order.child?.first_name || 'Unknown'}
                  </div>
                  <div className="text-sm text-center text-gray-400">
                    {order.child?.grade_level} - {order.child?.section}
                  </div>
                  <div className="mt-3 text-sm text-center font-medium">
                    {order.items.map(i => `${i.quantity}× ${i.product.name}`).join(', ')}
                  </div>
                  {waitTime.category !== 'normal' && order.status === 'pending' && (
                    <div className="mt-2 text-center text-red-400 font-bold">
                      ⏱ {waitTime.minutes}m waiting
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <PageHeader
            title="Staff Dashboard"
            subtitle={getSubtitle()}
          />
          <div className="flex items-center gap-2">
            {/* Peak Hour Indicator */}
            {peakHourStatus.isRush && (
              <span className="animate-pulse flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-bold">
                <Flame size={16} /> RUSH!
              </span>
            )}
            {peakHourStatus.isPeak && !peakHourStatus.isRush && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 text-white rounded-lg text-sm font-medium">
                <AlertTriangle size={14} /> Peak
              </span>
            )}
            
            {/* Stats Button */}
            <button
              onClick={() => setShowStatsPanel(!showStatsPanel)}
              className={`p-2 rounded-full ${showStatsPanel ? 'text-primary-600 bg-primary-50 dark:bg-primary-900/30' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-gray-100 dark:bg-gray-700'}`}
              title="View stats"
            >
              <BarChart3 size={20} />
            </button>
            
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-full ${soundEnabled ? 'text-primary-600 bg-primary-50 dark:bg-primary-900/30' : 'text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700'}`}
              title={soundEnabled ? 'Mute notifications' : 'Enable notifications'}
            >
              {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
            <button
              onClick={() => refetch()}
              className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full"
            >
              <RefreshCw size={20} />
            </button>
          </div>
        </div>

        {/* Stats Panel - Collapsible */}
        {showStatsPanel && orderStats && (
          <div className="mb-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg border border-blue-200 dark:border-blue-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-2">
                <TrendingUp size={18} /> Today's Performance
              </h3>
              <button onClick={() => setShowStatsPanel(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{orderStats.totalOrders}</div>
                <div className="text-xs text-gray-500">Total Orders</div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-600">{orderStats.completedOrders}</div>
                <div className="text-xs text-gray-500">Completed</div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-blue-600">{orderStats.completionRate}%</div>
                <div className="text-xs text-gray-500">Completion Rate</div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-purple-600">{orderStats.avgPrepTime}m</div>
                <div className="text-xs text-gray-500">Avg Prep Time</div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center">
                <div className={`text-2xl font-bold ${orderStats.pendingTooLong > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  {orderStats.pendingTooLong}
                </div>
                <div className="text-xs text-gray-500">Delayed ({'>'}15m)</div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-primary-600">₱{orderStats.totalRevenue.toFixed(0)}</div>
                <div className="text-xs text-gray-500">Revenue</div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
              <span>Order rate: {peakHourStatus.ordersPerHour}/hr</span>
              <span>•</span>
              <span className={`flex items-center gap-1 ${
                peakHourStatus.trend === 'increasing' ? 'text-green-600' : 
                peakHourStatus.trend === 'decreasing' ? 'text-red-600' : 'text-gray-500'
              }`}>
                {peakHourStatus.trend === 'increasing' ? '↑' : peakHourStatus.trend === 'decreasing' ? '↓' : '→'}
                {peakHourStatus.trend}
              </span>
            </div>
          </div>
        )}

        {/* Search Bar */}
        <div className="mb-4">
          <SearchBar 
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by name, class, or item..."
          />
        </div>

        {/* Date Filter Tabs */}
        <div className="flex gap-2 mb-4">
          {([
            { key: 'today', label: 'Today' },
            { key: 'future', label: 'Future Orders' },
            { key: 'all', label: 'All' }
          ] as { key: DateFilter; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setDateFilter(key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                dateFilter === key
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Status Summary Cards */}
        <div className="grid grid-cols-5 gap-2 mb-4">
          <button 
            onClick={() => setStatusFilter('all')}
            className={`bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm text-center transition-all ${statusFilter === 'all' ? 'ring-2 ring-primary-500' : ''}`}
          >
            <div className="text-xl font-bold text-primary-600 dark:text-primary-400">{statusCounts.total}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">All</div>
          </button>
          <button 
            onClick={() => setStatusFilter('awaiting_payment')}
            className={`bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm text-center transition-all ${statusFilter === 'awaiting_payment' ? 'ring-2 ring-orange-500' : ''}`}
          >
            <div className="text-xl font-bold text-orange-600 dark:text-orange-400">{statusCounts.awaitingPayment}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Awaiting</div>
          </button>
          <button 
            onClick={() => setStatusFilter('pending')}
            className={`bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm text-center transition-all ${statusFilter === 'pending' ? 'ring-2 ring-gray-500' : ''}`}
          >
            <div className="text-xl font-bold text-gray-700 dark:text-gray-300">{statusCounts.pending}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Pending</div>
          </button>
          <button 
            onClick={() => setStatusFilter('preparing')}
            className={`bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm text-center transition-all ${statusFilter === 'preparing' ? 'ring-2 ring-yellow-500' : ''}`}
          >
            <div className="text-xl font-bold text-yellow-600 dark:text-yellow-400">{statusCounts.preparing}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Preparing</div>
          </button>
          <button 
            onClick={() => setStatusFilter('ready')}
            className={`bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm text-center transition-all ${statusFilter === 'ready' ? 'ring-2 ring-green-500' : ''}`}
          >
            <div className="text-xl font-bold text-green-600">{statusCounts.ready}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Ready</div>
          </button>
        </div>

        {/* Kitchen Prep Summary - Grouped by Grade Level, then Meal Period */}
        {prepByGrade.length > 0 && (
          <details className="mb-4 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-lg border border-amber-200 dark:border-amber-800 overflow-hidden">
            <summary className="px-4 py-3 cursor-pointer hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ChefHat size={20} className="text-amber-600 dark:text-amber-400" />
                <span className="font-semibold text-amber-800 dark:text-amber-300">
                  Kitchen Prep Summary
                </span>
                <span className="text-xs bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded-full">
                  {itemsToPrep} items
                </span>
              </div>
              <span className="text-xs text-amber-600 dark:text-amber-400">Click to expand</span>
            </summary>
            <div className="px-4 pb-4 pt-2 space-y-3">
              {prepByGrade.map((gradeGroup) => (
                <div key={gradeGroup.gradeLevel} className="bg-white dark:bg-gray-800 rounded-lg border border-amber-200/50 dark:border-gray-700 overflow-hidden">
                  {/* Grade Header */}
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-100/50 dark:bg-gray-700/50 border-b border-amber-200/30 dark:border-gray-700">
                    <Users size={16} className="text-amber-600 dark:text-amber-400" />
                    <span className="font-semibold text-sm text-amber-800 dark:text-amber-300">
                      {gradeGroup.gradeLevel}
                    </span>
                    <span className="text-[10px] bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">
                      {gradeGroup.totalItems} items
                    </span>
                  </div>

                  {/* Meal Period Rows */}
                  <div className="divide-y divide-amber-100 dark:divide-gray-700/50">
                    {gradeGroup.meals.map((meal) => (
                      <div key={`${gradeGroup.gradeLevel}-${meal.mealPeriod}`} className="px-4 py-2.5 flex items-start gap-3">
                        {/* Meal label */}
                        <div className="flex items-center gap-1.5 min-w-[120px] pt-0.5">
                          <span>{MEAL_PERIOD_ICONS[meal.mealPeriod]}</span>
                          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                            {MEAL_PERIOD_LABELS[meal.mealPeriod]}
                          </span>
                        </div>
                        {/* Items inline with chips */}
                        <div className="flex flex-wrap gap-1.5 flex-1">
                          {meal.items.map((item) => (
                            <div 
                              key={item.name}
                              className="inline-flex items-center gap-1.5 bg-gray-50 dark:bg-gray-700 rounded-md px-2.5 py-1 border border-gray-200 dark:border-gray-600"
                            >
                              {item.image_url && (
                                <img 
                                  src={item.image_url} 
                                  alt={item.name}
                                  className="w-5 h-5 rounded object-cover"
                                />
                              )}
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{item.name}</span>
                              <span className="text-xs font-bold text-amber-600 dark:text-yellow-400">{item.quantity}</span>
                              {item.preparingQty > 0 && (
                                <span className="text-[9px] px-1 py-0.5 bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400 rounded">
                                  {item.preparingQty} prep
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Quick Stats Bar - Last Refresh & Keyboard Hints */}
        <div className="flex items-center justify-between mb-4 text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <RefreshCw size={12} />
              Last updated: {format(lastRefreshTime, 'h:mm:ss a')}
            </span>
            <span className="hidden sm:inline text-gray-400">•</span>
            <span className="hidden sm:inline">Auto-refresh: 10s</span>
          </div>
          <div className="hidden md:flex items-center gap-3">
            <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px]">P</span>
            <span>Prepare</span>
            <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px]">R</span>
            <span>Ready</span>
            <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px]">Esc</span>
            <span>Clear</span>
          </div>
        </div>

        {/* View Mode Toggle & Grade Controls */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('flat')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                viewMode === 'flat'
                  ? 'bg-primary-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'
              }`}
              title="Show all orders in a flat list"
            >
              <Users size={16} />
              <span className="hidden sm:inline">Flat</span>
            </button>
            <button
              onClick={() => setViewMode('grouped')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                viewMode === 'grouped'
                  ? 'bg-primary-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'
              }`}
              title="Group orders by grade level"
            >
              <Layers size={16} />
              <span className="hidden sm:inline">Grade</span>
            </button>
            <button
              onClick={() => { setViewMode('kitchen'); setIsKitchenFullscreen(true); }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                viewMode === 'kitchen'
                  ? 'bg-primary-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'
              }`}
              title="Kitchen display mode - fullscreen view for kitchen monitors"
            >
              <Maximize2 size={16} />
              <span className="hidden sm:inline">Kitchen</span>
            </button>
          </div>
          
          {/* Swipe hint for mobile */}
          <div className="flex items-center gap-2 text-xs text-gray-400 sm:hidden">
            <span>👆 Swipe right: next status</span>
          </div>
          
          {/* Expand/Collapse All (only in grouped view) */}
          {viewMode === 'grouped' && groupedOrders.length > 0 && (
            <div className="hidden sm:flex items-center gap-2">
              <button
                onClick={expandAllGrades}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Expand All
              </button>
              <button
                onClick={collapseAllGrades}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Collapse All
              </button>
            </div>
          )}
        </div>

        {/* Batch Actions */}
        {selectedOrders.length > 0 && (
          <div className="bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-800 rounded-lg p-3 mb-4 flex items-center justify-between">
            <span className="text-sm font-medium text-primary-700 dark:text-primary-400">
              {selectedOrders.length} order(s) selected
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => handleBatchStatusUpdate('preparing')}
                className="px-3 py-1.5 bg-yellow-500 text-white rounded-lg text-sm hover:bg-yellow-600"
              >
                Start All
              </button>
              <button
                onClick={() => handleBatchStatusUpdate('ready')}
                className="px-3 py-1.5 bg-green-500 text-white rounded-lg text-sm hover:bg-green-600"
              >
                Ready All
              </button>
              <button
                onClick={() => setSelectedOrders([])}
                className="px-3 py-1.5 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <LoadingSpinner size="lg" />
        ) : filteredOrders?.length === 0 ? (
          <div className="text-center py-12">
            <CheckCircle size={48} className="mx-auto text-green-500 mb-4" />
            <p className="text-gray-600 dark:text-gray-400">
              {searchQuery ? 'No orders match your search' : 'No orders in this category'}
            </p>
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="mt-2 text-primary-600 hover:underline"
              >
                Clear search
              </button>
            )}
          </div>
        ) : viewMode === 'grouped' ? (
          /* Grouped View - Orders by Grade Level */
          <div className="space-y-4">
            {groupedOrders.map((group) => {
              const isCollapsed = collapsedGrades.has(group.gradeLevel);
              const hasSelectableOrders = group.orders.some(o => o.status !== 'awaiting_payment');
              const isFullySelected = isGradeFullySelected(group.gradeLevel);
              
              return (
                <div key={group.gradeLevel} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden">
                  {/* Grade Level Header */}
                  <div className="flex items-center gap-2 p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    {/* Select All Checkbox for Grade */}
                    {hasSelectableOrders && (
                      <input
                        type="checkbox"
                        checked={isFullySelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleSelectAllInGrade(group.gradeLevel);
                        }}
                        className="w-5 h-5 min-w-[20px] rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 cursor-pointer"
                        title={`Select all orders in ${group.gradeLevel}`}
                      />
                    )}
                    {!hasSelectableOrders && <div className="w-5 min-w-[20px]" />}
                    
                    <button
                      onClick={() => toggleGradeCollapse(group.gradeLevel)}
                      className="flex-1 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${isCollapsed ? 'bg-gray-100 dark:bg-gray-700' : 'bg-primary-100 dark:bg-primary-900/30'}`}>
                          {isCollapsed ? (
                            <ChevronRight size={20} className="text-gray-600 dark:text-gray-400" />
                          ) : (
                            <ChevronDown size={20} className="text-primary-600 dark:text-primary-400" />
                          )}
                        </div>
                        <div className="text-left">
                          <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100">
                            {group.gradeLevel}
                          </h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {group.orderCount} order{group.orderCount !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                      
                      {/* Grade Status Summary Badges */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {group.awaitingPaymentCount > 0 && (
                          <span className="px-2.5 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded-full text-xs font-medium">
                            {group.awaitingPaymentCount} awaiting
                          </span>
                        )}
                        {group.pendingCount > 0 && (
                          <span className="px-2.5 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-xs font-medium">
                            {group.pendingCount} pending
                          </span>
                        )}
                        {group.preparingCount > 0 && (
                          <span className="px-2.5 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded-full text-xs font-medium">
                            {group.preparingCount} preparing
                          </span>
                        )}
                        {group.readyCount > 0 && (
                          <span className="px-2.5 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full text-xs font-medium">
                            {group.readyCount} ready
                          </span>
                        )}
                      </div>
                    </button>
                  </div>
                  
                  {/* Orders in this grade */}
                  {!isCollapsed && (
                    <div className="border-t border-gray-100 dark:border-gray-700 p-4 space-y-4">
                      {group.orders.map((order) => {
                        const waitTime = getWaitTimeCategory(order.created_at);
                        const isSelected = selectedOrders.includes(order.id);
                        const isAwaitingPayment = order.status === 'awaiting_payment';
                        const paymentTimeRemaining = getPaymentTimeRemaining(order.payment_due_at);
                        const isExpired = isPaymentExpired(order.payment_due_at, order.payment_status);
                        const isSwipingThis = swipingOrder === order.id;
                        const orderStaffNotes = localStaffNotes[order.id] || [];
                        
                        const getBorderClass = () => {
                          if (isAwaitingPayment && isExpired) return 'border-l-4 border-l-red-500';
                          if (isAwaitingPayment) return 'border-l-4 border-l-orange-500';
                          if (waitTime.category === 'critical' && order.status === 'pending') return 'border-l-4 border-l-red-500';
                          if (isSelected) return 'border-primary-500';
                          return 'border-gray-200 dark:border-gray-600';
                        };
                        
                        return (
                          <div 
                            key={order.id} 
                            className={`bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border-2 transition-all ${getBorderClass()} ${
                              isSelected ? 'bg-primary-50 dark:bg-primary-900/30' : ''
                            } ${isSwipingThis ? 'relative overflow-hidden' : ''}`}
                            style={{ 
                              transform: isSwipingThis ? `translateX(${swipeOffset}px)` : 'none',
                              transition: isSwipingThis ? 'none' : 'transform 0.3s ease-out'
                            }}
                            onTouchStart={(e) => handleTouchStart(e, order.id, order.status)}
                            onTouchMove={handleTouchMove}
                            onTouchEnd={() => handleTouchEnd(order)}
                          >
                            {/* Swipe background indicators */}
                            {isSwipingThis && swipeOffset > 30 && (
                              <div className="absolute inset-y-0 left-0 w-20 bg-green-500 flex items-center justify-center text-white">
                                <CheckCircle size={24} />
                              </div>
                            )}
                            {isSwipingThis && swipeOffset < -30 && order.status === 'pending' && (
                              <div className="absolute inset-y-0 right-0 w-20 bg-red-500 flex items-center justify-center text-white">
                                <X size={24} />
                              </div>
                            )}
                            
                            {/* Order Number Badge - Prominent for calling students */}
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="px-3 py-1 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg font-mono font-bold text-lg tracking-wider">
                                  #{order.id.slice(-4).toUpperCase()}
                                </span>
                                {order.status === 'ready' && (
                                  <button
                                    onClick={() => {
                                      // Announce order ready
                                      if ('speechSynthesis' in window) {
                                        const msg = new SpeechSynthesisUtterance(
                                          `Order ${order.id.slice(-4)} for ${order.child?.first_name || 'student'} is ready`
                                        );
                                        window.speechSynthesis.speak(msg);
                                      }
                                      showToast(`📢 Announced: Order #${order.id.slice(-4).toUpperCase()}`, 'success');
                                    }}
                                    className="p-1.5 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-200 dark:hover:bg-green-900 transition-colors"
                                    title="Announce order ready"
                                  >
                                    <Bell size={16} />
                                  </button>
                                )}
                              </div>
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                {format(new Date(order.created_at), 'h:mm a')}
                              </span>
                            </div>
                            
                            {/* Order Header */}
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleOrderSelection(order.id)}
                                  className="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                                  disabled={isAwaitingPayment}
                                />
                                <div className={`p-2 rounded-full ${getStatusBadge(order.status, order.payment_status)}`}>
                                  {getStatusIcon(order.status, order.payment_status)}
                                </div>
                                <div>
                                  <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100">
                                    {order.child?.first_name || 'Unknown'} {order.child?.last_name || 'Student'}
                                  </h3>
                                  <p className="text-sm text-gray-600 dark:text-gray-400">
                                    Section: {order.child?.section || '-'}
                                  </p>
                                </div>
                              </div>
                              <div className="text-right">
                                <span className="text-xl font-bold text-primary-600">
                                  ₱{order.total_amount.toFixed(2)}
                                </span>
                                {isAwaitingPayment && paymentTimeRemaining && (
                                  <div className={`text-xs mt-1 px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${paymentTimeRemaining === 'Expired' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'}`}>
                                    <Timer size={12} />
                                    {paymentTimeRemaining}
                                  </div>
                                )}
                                {!isAwaitingPayment && (
                                  <div className={`text-xs mt-1 px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${getWaitTimeColor(waitTime.category)}`}>
                                    <Timer size={12} />
                                    {waitTime.minutes}m ago
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Awaiting Payment Banner */}
                            {isAwaitingPayment && (
                              <div className={`border rounded-lg p-3 mb-3 ${
                                isPaymentExpired(order.payment_due_at, order.payment_status)
                                  ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800'
                                  : 'bg-orange-50 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800'
                              }`}>
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                  <div className="flex items-center gap-2">
                                    <Banknote className={isPaymentExpired(order.payment_due_at, order.payment_status) ? 'text-red-600 dark:text-red-400' : 'text-orange-600 dark:text-orange-400'} size={20} />
                                    <span className={`text-sm font-medium ${
                                      isPaymentExpired(order.payment_due_at, order.payment_status)
                                        ? 'text-red-800 dark:text-red-300'
                                        : 'text-orange-800 dark:text-orange-300'
                                    }`}>
                                      {isPaymentExpired(order.payment_due_at, order.payment_status)
                                        ? 'Payment expired - Order will be cancelled'
                                        : `Cash payment pending - ₱${order.total_amount.toFixed(2)}`
                                      }
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {isPaymentExpired(order.payment_due_at, order.payment_status) ? (
                                      <span className="px-3 py-1.5 bg-red-200 dark:bg-red-800 text-red-700 dark:text-red-300 rounded-lg text-sm font-medium cursor-not-allowed">
                                        Expired
                                      </span>
                                    ) : (
                                      <>
                                        <button
                                          onClick={() => setShowCancelDialog(order.id)}
                                          className="px-3 py-1.5 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-500"
                                        >
                                          Cancel
                                        </button>
                                        <button
                                          onClick={() => setShowPaymentDialog(order.id)}
                                          className="px-3 py-1.5 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700"
                                        >
                                          Confirm Payment
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Parent Info */}
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                              Parent: {order.parent?.first_name || 'Unknown'} {order.parent?.last_name || ''}
                              {order.parent?.phone_number && ` • ${order.parent.phone_number}`}
                              {order.payment_method && ` • `}
                              {order.payment_method === 'cash' && <span className="text-orange-600 dark:text-orange-400 font-medium">CASH</span>}
                              {order.payment_method === 'balance' && <span className="text-green-600 dark:text-green-400 font-medium">BALANCE</span>}
                              {order.payment_method === 'gcash' && <span className="text-blue-600 dark:text-blue-400 font-medium">GCASH</span>}
                            </p>

                            {/* Scheduled Date (for future orders) */}
                            {dateFilter !== 'today' && order.scheduled_for && (
                              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-2 mb-3 flex items-center gap-2">
                                <span className="text-blue-600 dark:text-blue-400">📅</span>
                                <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
                                  Scheduled for: {format(new Date(order.scheduled_for + 'T00:00:00'), 'EEEE, MMMM d, yyyy')}
                                </span>
                              </div>
                            )}

                            {/* Order Notes */}
                            {order.notes && (
                              <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 mb-3">
                                <p className="text-sm text-yellow-800 dark:text-yellow-300">📝 {order.notes}</p>
                              </div>
                            )}

                            {/* Staff Notes Section */}
                            {(orderStaffNotes.length > 0 || staffNoteInput?.orderId === order.id) && (
                              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-3">
                                <div className="flex items-center gap-2 mb-2">
                                  <MessageSquare size={14} className="text-blue-600 dark:text-blue-400" />
                                  <span className="text-xs font-medium text-blue-800 dark:text-blue-300">Staff Notes</span>
                                </div>
                                {orderStaffNotes.map((note, idx) => (
                                  <p key={idx} className="text-xs text-blue-700 dark:text-blue-400 mb-1">{note}</p>
                                ))}
                                {staffNoteInput?.orderId === order.id && (
                                  <div className="flex gap-2 mt-2">
                                    <input
                                      type="text"
                                      value={staffNoteInput.note}
                                      onChange={(e) => setStaffNoteInput({ orderId: order.id, note: e.target.value })}
                                      placeholder="Add a note..."
                                      className="flex-1 px-2 py-1 text-xs border border-blue-300 dark:border-blue-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') addStaffNote(order.id, staffNoteInput.note);
                                        if (e.key === 'Escape') setStaffNoteInput(null);
                                      }}
                                      autoFocus
                                    />
                                    <button
                                      onClick={() => addStaffNote(order.id, staffNoteInput.note)}
                                      className="p-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                                    >
                                      <Send size={14} />
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Order Items */}
                            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 mb-4">
                              {order.items.map((item) => (
                                <div key={item.id} className="flex justify-between py-1">
                                  <div className="flex items-center gap-2">
                                    {item.product.image_url && (
                                      <img 
                                        src={item.product.image_url} 
                                        alt="" 
                                        className="w-8 h-8 rounded object-cover"
                                      />
                                    )}
                                    <span className="text-sm text-gray-900 dark:text-gray-100">{item.product.name}</span>
                                  </div>
                                  <span className="font-medium text-sm text-gray-900 dark:text-gray-100">x{item.quantity}</span>
                                </div>
                              ))}
                            </div>

                            {/* Action Buttons */}
                            <div className="flex gap-2">
                              {order.status === 'pending' && (
                                <>
                                  <button
                                    onClick={() => updateOrderStatus(order.id, 'preparing')}
                                    className="flex-1 bg-yellow-500 text-white py-3 rounded-lg hover:bg-yellow-600 font-medium flex items-center justify-center gap-2"
                                  >
                                    <ChefHat size={18} />
                                    Start Preparing
                                  </button>
                                  <button
                                    onClick={() => setShowCancelDialog(order.id)}
                                    className="p-3 text-red-600 hover:bg-red-50 dark:hover:bg-red-900 rounded-lg"
                                    title="Cancel order"
                                  >
                                    <X size={18} />
                                  </button>
                                </>
                              )}
                              {order.status === 'preparing' && (
                                <button
                                  onClick={() => updateOrderStatus(order.id, 'ready')}
                                  className="flex-1 bg-green-500 text-white py-3 rounded-lg hover:bg-green-600 font-medium flex items-center justify-center gap-2"
                                >
                                  <Bell size={18} />
                                  Mark Ready
                                </button>
                              )}
                              {order.status === 'ready' && (
                                <button
                                  onClick={() => updateOrderStatus(order.id, 'completed')}
                                  className="flex-1 bg-blue-500 text-white py-3 rounded-lg hover:bg-blue-600 font-medium flex items-center justify-center gap-2"
                                >
                                  <CheckCircle size={18} />
                                  Complete Order
                                </button>
                              )}
                              {/* Add Note Button */}
                              <button
                                onClick={() => setStaffNoteInput({ orderId: order.id, note: '' })}
                                className="p-3 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded-lg"
                                title="Add staff note"
                              >
                                <MessageSquare size={18} />
                              </button>
                              {/* Print buttons */}
                              <button
                                onClick={() => printOrder(order, false)}
                                className="p-3 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                                title="Print order (standard)"
                              >
                                <Printer size={18} />
                              </button>
                              <button
                                onClick={() => printOrder(order, true)}
                                className="p-3 text-gray-500 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-xs"
                                title="Print for thermal printer (80mm)"
                              >
                                80mm
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* Flat View - All Orders */
          <div className="grid gap-4">
            {filteredOrders?.map((order) => {
              const waitTime = getWaitTimeCategory(order.created_at);
              const isSelected = selectedOrders.includes(order.id);
              const isAwaitingPayment = order.status === 'awaiting_payment';
              const paymentTimeRemaining = getPaymentTimeRemaining(order.payment_due_at);
              const isExpired = isPaymentExpired(order.payment_due_at, order.payment_status);
              
              // Determine border style (priority: expired > awaiting_payment > critical wait > selected > default)
              const getBorderClass = () => {
                if (isAwaitingPayment && isExpired) return 'border-l-4 border-l-red-500';
                if (isAwaitingPayment) return 'border-l-4 border-l-orange-500';
                if (waitTime.category === 'critical' && order.status === 'pending') return 'border-l-4 border-l-red-500';
                if (isSelected) return 'border-primary-500';
                return 'border-gray-100 dark:border-gray-700';
              };

              const isSwipingThis = swipingOrder === order.id;
              const orderStaffNotes = localStaffNotes[order.id] || [];
              
              return (
                <div 
                  key={order.id}
                  className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm p-5 border-2 transition-all ${getBorderClass()} ${
                    isSelected ? 'bg-primary-50 dark:bg-primary-900/30' : ''
                  } ${isSwipingThis ? 'relative overflow-hidden' : ''}`}
                  style={{ 
                    transform: isSwipingThis ? `translateX(${swipeOffset}px)` : 'none',
                    transition: isSwipingThis ? 'none' : 'transform 0.3s ease-out'
                  }}
                  onTouchStart={(e) => handleTouchStart(e, order.id, order.status)}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={() => handleTouchEnd(order)}
                >
                  {/* Swipe background indicators */}
                  {isSwipingThis && swipeOffset > 30 && (
                    <div className="absolute inset-y-0 left-0 w-20 bg-green-500 flex items-center justify-center text-white">
                      <CheckCircle size={24} />
                    </div>
                  )}
                  {isSwipingThis && swipeOffset < -30 && order.status === 'pending' && (
                    <div className="absolute inset-y-0 right-0 w-20 bg-red-500 flex items-center justify-center text-white">
                      <X size={24} />
                    </div>
                  )}
                  
                  {/* Order Number Badge - Prominent for calling students */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg font-mono font-bold text-lg tracking-wider">
                        #{order.id.slice(-4).toUpperCase()}
                      </span>
                      {order.status === 'ready' && (
                        <button
                          onClick={() => {
                            if ('speechSynthesis' in window) {
                              const msg = new SpeechSynthesisUtterance(
                                `Order ${order.id.slice(-4)} for ${order.child?.first_name || 'student'} is ready`
                              );
                              window.speechSynthesis.speak(msg);
                            }
                            showToast(`📢 Announced: Order #${order.id.slice(-4).toUpperCase()}`, 'success');
                          }}
                          className="p-1.5 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-200 dark:hover:bg-green-900 transition-colors"
                          title="Announce order ready"
                        >
                          <Bell size={16} />
                        </button>
                      )}
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {format(new Date(order.created_at), 'h:mm a')}
                    </span>
                  </div>
                  
                  {/* Order Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOrderSelection(order.id)}
                        className="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                        disabled={isAwaitingPayment}
                      />
                      <div className={`p-2 rounded-full ${getStatusBadge(order.status, order.payment_status)}`}>
                        {getStatusIcon(order.status, order.payment_status)}
                      </div>
                      <div>
                        <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100">
                          {order.child?.first_name || 'Unknown'} {order.child?.last_name || 'Student'}
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {order.child?.grade_level || '-'} - {order.child?.section || '-'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xl font-bold text-primary-600">
                        ₱{order.total_amount.toFixed(2)}
                      </span>
                      {isAwaitingPayment && paymentTimeRemaining && (
                        <div className={`text-xs mt-1 px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${paymentTimeRemaining === 'Expired' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'}`}>
                          <Timer size={12} />
                          {paymentTimeRemaining}
                        </div>
                      )}
                      {!isAwaitingPayment && (
                        <div className={`text-xs mt-1 px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${getWaitTimeColor(waitTime.category)}`}>
                          <Timer size={12} />
                          {waitTime.minutes}m ago
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Awaiting Payment Banner */}
                  {isAwaitingPayment && (
                    <div className={`border rounded-lg p-3 mb-3 ${
                      isPaymentExpired(order.payment_due_at, order.payment_status)
                        ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800'
                        : 'bg-orange-50 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800'
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Banknote className={isPaymentExpired(order.payment_due_at, order.payment_status) ? 'text-red-600 dark:text-red-400' : 'text-orange-600 dark:text-orange-400'} size={20} />
                          <span className={`text-sm font-medium ${
                            isPaymentExpired(order.payment_due_at, order.payment_status)
                              ? 'text-red-800 dark:text-red-300'
                              : 'text-orange-800 dark:text-orange-300'
                          }`}>
                            {isPaymentExpired(order.payment_due_at, order.payment_status)
                              ? 'Payment expired - Order will be cancelled'
                              : `Cash payment pending - ₱${order.total_amount.toFixed(2)}`
                            }
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {isPaymentExpired(order.payment_due_at, order.payment_status) ? (
                            <span className="px-3 py-1.5 bg-red-200 dark:bg-red-800 text-red-700 dark:text-red-300 rounded-lg text-sm font-medium cursor-not-allowed">
                              Expired
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => setShowCancelDialog(order.id)}
                                className="px-3 py-1.5 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-500"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => setShowPaymentDialog(order.id)}
                                className="px-3 py-1.5 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700"
                              >
                                Confirm Payment
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Parent Info */}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    Parent: {order.parent?.first_name || 'Unknown'} {order.parent?.last_name || ''}
                    {order.parent?.phone_number && ` • ${order.parent.phone_number}`}
                    {order.payment_method && ` • `}
                    {order.payment_method === 'cash' && <span className="text-orange-600 dark:text-orange-400 font-medium">CASH</span>}
                    {order.payment_method === 'balance' && <span className="text-green-600 dark:text-green-400 font-medium">BALANCE</span>}
                    {order.payment_method === 'gcash' && <span className="text-blue-600 dark:text-blue-400 font-medium">GCASH</span>}
                  </p>

                  {/* Scheduled Date (for future orders) */}
                  {dateFilter !== 'today' && order.scheduled_for && (
                    <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-2 mb-3 flex items-center gap-2">
                      <span className="text-blue-600 dark:text-blue-400">📅</span>
                      <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
                        Scheduled for: {format(new Date(order.scheduled_for + 'T00:00:00'), 'EEEE, MMMM d, yyyy')}
                      </span>
                    </div>
                  )}

                  {/* Order Notes */}
                  {order.notes && (
                    <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 mb-3">
                      <p className="text-sm text-yellow-800 dark:text-yellow-300">📝 {order.notes}</p>
                    </div>
                  )}

                  {/* Staff Notes Section */}
                  {(orderStaffNotes.length > 0 || staffNoteInput?.orderId === order.id) && (
                    <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-3">
                      <div className="flex items-center gap-2 mb-2">
                        <MessageSquare size={14} className="text-blue-600 dark:text-blue-400" />
                        <span className="text-xs font-medium text-blue-800 dark:text-blue-300">Staff Notes</span>
                      </div>
                      {orderStaffNotes.map((note, idx) => (
                        <p key={idx} className="text-xs text-blue-700 dark:text-blue-400 mb-1">{note}</p>
                      ))}
                      {staffNoteInput?.orderId === order.id && (
                        <div className="flex gap-2 mt-2">
                          <input
                            type="text"
                            value={staffNoteInput.note}
                            onChange={(e) => setStaffNoteInput({ orderId: order.id, note: e.target.value })}
                            placeholder="Add a note..."
                            className="flex-1 px-2 py-1 text-xs border border-blue-300 dark:border-blue-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') addStaffNote(order.id, staffNoteInput.note);
                              if (e.key === 'Escape') setStaffNoteInput(null);
                            }}
                            autoFocus
                          />
                          <button
                            onClick={() => addStaffNote(order.id, staffNoteInput.note)}
                            className="p-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                          >
                            <Send size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Order Items */}
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 mb-4">
                    {order.items.map((item) => (
                      <div key={item.id} className="flex justify-between py-1">
                        <div className="flex items-center gap-2">
                          {item.product.image_url && (
                            <img 
                              src={item.product.image_url} 
                              alt="" 
                              className="w-8 h-8 rounded object-cover"
                            />
                          )}
                          <span className="text-sm text-gray-900 dark:text-gray-100">{item.product.name}</span>
                        </div>
                        <span className="font-medium text-sm text-gray-900 dark:text-gray-100">x{item.quantity}</span>
                      </div>
                    ))}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-2">
                    {order.status === 'pending' && (
                      <>
                        <button
                          onClick={() => updateOrderStatus(order.id, 'preparing')}
                          className="flex-1 bg-yellow-500 text-white py-3 rounded-lg hover:bg-yellow-600 font-medium flex items-center justify-center gap-2"
                        >
                          <ChefHat size={18} />
                          Start Preparing
                        </button>
                        <button
                          onClick={() => setShowCancelDialog(order.id)}
                          className="p-3 text-red-600 hover:bg-red-50 dark:hover:bg-red-900 rounded-lg"
                          title="Cancel order"
                        >
                          <X size={18} />
                        </button>
                      </>
                    )}
                    {order.status === 'preparing' && (
                      <button
                        onClick={() => updateOrderStatus(order.id, 'ready')}
                        className="flex-1 bg-green-500 text-white py-3 rounded-lg hover:bg-green-600 font-medium flex items-center justify-center gap-2"
                      >
                        <Bell size={18} />
                        Mark Ready
                      </button>
                    )}
                    {order.status === 'ready' && (
                      <button
                        onClick={() => updateOrderStatus(order.id, 'completed')}
                        className="flex-1 bg-blue-500 text-white py-3 rounded-lg hover:bg-blue-600 font-medium flex items-center justify-center gap-2"
                      >
                        <CheckCircle size={18} />
                        Complete Order
                      </button>
                    )}
                    {/* Add Note Button */}
                    <button
                      onClick={() => setStaffNoteInput({ orderId: order.id, note: '' })}
                      className="p-3 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded-lg"
                      title="Add staff note"
                    >
                      <MessageSquare size={18} />
                    </button>
                    {/* Print buttons */}
                    <button
                      onClick={() => printOrder(order, false)}
                      className="p-3 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                      title="Print order (standard)"
                    >
                      <Printer size={18} />
                    </button>
                    <button
                      onClick={() => printOrder(order, true)}
                      className="p-3 text-gray-500 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-xs"
                      title="Print for thermal printer (80mm)"
                    >
                      80mm
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cancel Order Dialog */}
      <ConfirmDialog
        isOpen={!!showCancelDialog}
        onCancel={() => setShowCancelDialog(null)}
        onConfirm={() => showCancelDialog && handleCancelOrder(showCancelDialog)}
        title="Cancel Order?"
        message="Are you sure you want to cancel this order? This action cannot be undone."
        confirmLabel="Cancel Order"
        type="danger"
      />

      {/* Confirm Cash Payment Dialog */}
      <ConfirmDialog
        isOpen={!!showPaymentDialog}
        onCancel={() => setShowPaymentDialog(null)}
        onConfirm={() => showPaymentDialog && confirmCashPayment(showPaymentDialog)}
        title="Confirm Cash Payment?"
        message={`Have you received the cash payment for this order? Once confirmed, the order will move to "Pending" status for preparation.`}
        confirmLabel="Yes, Payment Received"
        type="success"
      />
    </div>
  );
}