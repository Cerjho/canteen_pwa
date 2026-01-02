import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, ChefHat, CheckCircle, RefreshCw, Bell, Volume2, VolumeX, Printer, Timer, X, Banknote } from 'lucide-react';
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

// Helper to format date in local timezone (avoids UTC shift issues)
function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

type DateFilter = 'today' | 'future' | 'all';

export default function StaffDashboard() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('today');
  const [searchQuery, setSearchQuery] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showCancelDialog, setShowCancelDialog] = useState<string | null>(null);
  const [showPaymentDialog, setShowPaymentDialog] = useState<string | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const previousOrderCount = useRef<number>(0);
  const { showToast } = useToast();

  const { data: orders, isLoading, refetch } = useQuery<StaffOrder[]>({
    queryKey: ['staff-orders', statusFilter, dateFilter],
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
      
      if (statusFilter === 'all') {
        query = query.in('status', ['awaiting_payment', 'pending', 'preparing', 'ready']);
      } else {
        query = query.eq('status', statusFilter);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 10000 // Refetch every 10 seconds (faster for payment updates)
  });

  // Filter orders by search query
  const filteredOrders = useMemo(() => {
    if (!orders) return [];
    if (!searchQuery.trim()) return orders;
    
    const query = searchQuery.toLowerCase();
    return orders.filter(order => 
      `${order.child?.first_name || ''} ${order.child?.last_name || ''}`.toLowerCase().includes(query) ||
      `${order.child?.grade_level || ''} ${order.child?.section || ''}`.toLowerCase().includes(query) ||
      order.items.some(item => item.product.name.toLowerCase().includes(query))
    );
  }, [orders, searchQuery]);

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

  // Confirm cash payment
  const confirmCashPayment = async (orderId: string) => {
    try {
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

  const handleBatchStatusUpdate = async (status: string) => {
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
  };

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

  const getWaitTimeColor = (category: 'normal' | 'warning' | 'critical') => {
    switch (category) {
      case 'critical': return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30';
      case 'warning': return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30';
      default: return 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700';
    }
  };

  const awaitingPaymentCount = filteredOrders?.filter(o => o.status === 'awaiting_payment').length || 0;
  const pendingCount = filteredOrders?.filter(o => o.status === 'pending').length || 0;
  const preparingCount = filteredOrders?.filter(o => o.status === 'preparing').length || 0;
  const readyCount = filteredOrders?.filter(o => o.status === 'ready').length || 0;

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
        <div className="grid grid-cols-4 gap-2 mb-4">
          <button 
            onClick={() => setStatusFilter('awaiting_payment')}
            className={`bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm text-center transition-all ${statusFilter === 'awaiting_payment' ? 'ring-2 ring-orange-500' : ''}`}
          >
            <div className="text-xl font-bold text-orange-600 dark:text-orange-400">{awaitingPaymentCount}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Awaiting Pay</div>
          </button>
          <button 
            onClick={() => setStatusFilter('pending')}
            className={`bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm text-center transition-all ${statusFilter === 'pending' ? 'ring-2 ring-primary-500' : ''}`}
          >
            <div className="text-xl font-bold text-gray-700 dark:text-gray-300">{pendingCount}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Pending</div>
          </button>
          <button 
            onClick={() => setStatusFilter('preparing')}
            className={`bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm text-center transition-all ${statusFilter === 'preparing' ? 'ring-2 ring-primary-500' : ''}`}
          >
            <div className="text-xl font-bold text-yellow-600 dark:text-yellow-400">{preparingCount}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Preparing</div>
          </button>
          <button 
            onClick={() => setStatusFilter('ready')}
            className={`bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm text-center transition-all ${statusFilter === 'ready' ? 'ring-2 ring-primary-500' : ''}`}
          >
            <div className="text-xl font-bold text-green-600">{readyCount}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Ready</div>
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {(['all', 'awaiting_payment', 'pending', 'preparing', 'ready'] as StatusFilter[]).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                statusFilter === status
                  ? status === 'awaiting_payment' ? 'bg-orange-600 text-white' : 'bg-primary-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {status === 'awaiting_payment' ? 'Awaiting Pay' : status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
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
        ) : (
          <div className="grid gap-4">
            {filteredOrders?.map((order) => {
              const waitTime = getWaitTimeCategory(order.created_at);
              const isSelected = selectedOrders.includes(order.id);
              const isAwaitingPayment = order.status === 'awaiting_payment';
              const paymentTimeRemaining = getPaymentTimeRemaining(order.payment_due_at);
              
              return (
                <div 
                  key={order.id} 
                  className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm p-5 border-2 transition-all ${
                    isSelected ? 'border-primary-500 bg-primary-50 dark:bg-primary-900' : 'border-gray-100 dark:border-gray-700'
                  } ${isAwaitingPayment ? 'border-l-4 border-l-orange-500' : ''} ${waitTime.category === 'critical' && order.status === 'pending' ? 'border-l-4 border-l-red-500' : ''}`}
                >
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
                    <div className="bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800 rounded-lg p-3 mb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Banknote className="text-orange-600 dark:text-orange-400" size={20} />
                          <span className="text-sm font-medium text-orange-800 dark:text-orange-300">
                            Cash payment pending - ₱{order.total_amount.toFixed(2)}
                          </span>
                        </div>
                        <button
                          onClick={() => setShowPaymentDialog(order.id)}
                          className="px-3 py-1.5 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700"
                        >
                          Confirm Payment
                        </button>
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
                    {!isAwaitingPayment && (
                      <button
                        onClick={() => printOrder(order)}
                        className="p-3 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                        title="Print order"
                      >
                        <Printer size={18} />
                      </button>
                    )}
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