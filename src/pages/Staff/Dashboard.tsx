import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, ChefHat, CheckCircle, RefreshCw, Bell, Volume2, VolumeX, Printer, Timer, X, Banknote, ChevronDown, ChevronRight, Users, Layers } from 'lucide-react';
import { format, differenceInMinutes } from 'date-fns';
import { supabase } from '../../services/supabaseClient';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { SearchBar } from '../../components/SearchBar';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { playNotificationSound } from '../../utils/notificationSound';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
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
  notes?: string;
  payment_method: string;
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
type ViewMode = 'flat' | 'grouped';

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
            product:products(name, image_url)
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

  // Aggregate items to prepare (for kitchen view) - only pending and preparing orders
  const itemsToPrep = useMemo(() => {
    if (!orders) return [];
    
    const itemMap = new Map<string, { name: string; quantity: number; image_url: string; pendingQty: number; preparingQty: number }>();
    
    orders
      .filter(o => o.status === 'pending' || o.status === 'preparing')
      .forEach(order => {
        order.items.forEach(item => {
          const existing = itemMap.get(item.product.name);
          if (existing) {
            existing.quantity += item.quantity;
            if (order.status === 'pending') {
              existing.pendingQty += item.quantity;
            } else {
              existing.preparingQty += item.quantity;
            }
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
    
    return Array.from(itemMap.values()).sort((a, b) => b.quantity - a.quantity);
  }, [orders]);

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

  // Track order count for notifications
  useEffect(() => {
    if (orders && orders.length > previousOrderCount.current && previousOrderCount.current > 0) {
      // New orders came in
      if (soundEnabled) {
        playNotificationSound(0.5);
      }
    }
    previousOrderCount.current = orders?.length || 0;
  }, [orders, soundEnabled]);

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

  const printOrder = (order: StaffOrder) => {
    const printContent = `
      <html>
        <head>
          <title>Order #${order.id.slice(-6)}</title>
          <style>
            body { font-family: sans-serif; padding: 20px; }
            h1 { font-size: 18px; margin-bottom: 10px; }
            .info { margin-bottom: 8px; }
            .items { border-top: 1px dashed #ccc; padding-top: 10px; margin-top: 10px; }
            .item { display: flex; justify-content: space-between; padding: 4px 0; }
          </style>
        </head>
        <body>
          <h1>Order #${order.id.slice(-6)}</h1>
          <div class="info"><strong>Student:</strong> ${order.child?.first_name || 'Unknown'} ${order.child?.last_name || 'Student'}</div>
          <div class="info"><strong>Class:</strong> ${order.child?.grade_level || '-'} - ${order.child?.section || '-'}</div>
          <div class="info"><strong>Time:</strong> ${format(new Date(order.created_at), 'h:mm a')}</div>
          ${order.notes ? `<div class="info"><strong>Notes:</strong> ${order.notes}</div>` : ''}
          <div class="items">
            ${order.items.map(item => `
              <div class="item">
                <span>${item.product.name}</span>
                <span>x${item.quantity}</span>
              </div>
            `).join('')}
          </div>
          <div style="margin-top: 10px; border-top: 1px solid #000; padding-top: 10px;">
            <strong>Total: ₱${order.total_amount.toFixed(2)}</strong>
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

  return (
    <div className="min-h-screen pb-20 bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <PageHeader
            title="Staff Dashboard"
            subtitle={getSubtitle()}
          />
          <div className="flex items-center gap-2">
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

        {/* Kitchen Prep Summary - Collapsible */}
        {itemsToPrep.length > 0 && (
          <details className="mb-4 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-lg border border-amber-200 dark:border-amber-800 overflow-hidden">
            <summary className="px-4 py-3 cursor-pointer hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ChefHat size={20} className="text-amber-600 dark:text-amber-400" />
                <span className="font-semibold text-amber-800 dark:text-amber-300">
                  Kitchen Prep Summary
                </span>
                <span className="text-xs bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded-full">
                  {itemsToPrep.reduce((sum, i) => sum + i.quantity, 0)} items
                </span>
              </div>
              <span className="text-xs text-amber-600 dark:text-amber-400">Click to expand</span>
            </summary>
            <div className="px-4 pb-4 pt-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {itemsToPrep.map((item) => (
                <div 
                  key={item.name}
                  className="bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm flex flex-col items-center text-center"
                >
                  {item.image_url && (
                    <img 
                      src={item.image_url} 
                      alt={item.name}
                      className="w-12 h-12 rounded-lg object-cover mb-2"
                    />
                  )}
                  <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {item.quantity}×
                  </span>
                  <span className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                    {item.name}
                  </span>
                  <div className="flex gap-1 mt-1">
                    {item.pendingQty > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">
                        {item.pendingQty} pending
                      </span>
                    )}
                    {item.preparingQty > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400 rounded">
                        {item.preparingQty} prep
                      </span>
                    )}
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
              <span className="hidden sm:inline">Flat View</span>
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
              <span className="hidden sm:inline">By Grade</span>
            </button>
          </div>
          
          {/* Expand/Collapse All (only in grouped view) */}
          {viewMode === 'grouped' && groupedOrders.length > 0 && (
            <div className="flex items-center gap-2">
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
                            }`}
                          >
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
                                      const msg = new SpeechSynthesisUtterance(
                                        `Order ${order.id.slice(-4)} for ${order.child?.first_name || 'student'} is ready`
                                      );
                                      window.speechSynthesis.speak(msg);
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
                              <button
                                onClick={() => printOrder(order)}
                                className="p-3 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                                title="Print order"
                              >
                                <Printer size={18} />
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
              
              return (
                <div 
                  key={order.id} 
                  className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm p-5 border-2 transition-all ${getBorderClass()} ${
                    isSelected ? 'bg-primary-50 dark:bg-primary-900/30' : ''
                  }`}
                >
                  {/* Order Number Badge - Prominent for calling students */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg font-mono font-bold text-lg tracking-wider">
                        #{order.id.slice(-4).toUpperCase()}
                      </span>
                      {order.status === 'ready' && (
                        <button
                          onClick={() => {
                            const msg = new SpeechSynthesisUtterance(
                              `Order ${order.id.slice(-4)} for ${order.child?.first_name || 'student'} is ready`
                            );
                            window.speechSynthesis.speak(msg);
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
                    <button
                      onClick={() => printOrder(order)}
                      className="p-3 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                      title="Print order"
                    >
                      <Printer size={18} />
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