import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { 
  Search, 
  RefreshCw, 
  Eye,
  Download,
  RotateCcw,
  AlertTriangle
} from 'lucide-react';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../services/supabaseClient';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { OrderStatus } from '../../types';

interface OrderWithDetails {
  id: string;
  status: OrderStatus;
  total_amount: number;
  payment_method: string;
  notes?: string;
  created_at: string;
  completed_at?: string;
  child: { first_name: string; last_name: string; grade_level: string; section?: string };
  parent: { first_name: string; last_name: string; phone_number?: string; email: string };
  items: Array<{
    id: string;
    quantity: number;
    price_at_order: number;
    product: { name: string; image_url?: string };
  }>;
}

const STATUS_OPTIONS: OrderStatus[] = ['pending', 'preparing', 'ready', 'completed', 'cancelled'];

export default function AdminOrders() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all');
  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'month' | 'all'>('today');
  const [selectedOrder, setSelectedOrder] = useState<OrderWithDetails | null>(null);
  const [refundOrder, setRefundOrder] = useState<OrderWithDetails | null>(null);

  // Fetch orders
  const { data: orders, isLoading, refetch } = useQuery<OrderWithDetails[]>({
    queryKey: ['admin-orders', statusFilter, dateFilter],
    queryFn: async () => {
      let query = supabase
        .from('orders')
        .select(`
          *,
          child:students!orders_student_id_fkey(first_name, last_name, grade_level, section),
          parent:user_profiles(first_name, last_name, phone_number, email),
          items:order_items(
            id,
            quantity,
            price_at_order,
            product:products(name, image_url)
          )
        `)
        .order('created_at', { ascending: false });

      // Status filter
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      // Date filter
      if (dateFilter !== 'all') {
        const now = new Date();
        let startDate: Date;
        
        if (dateFilter === 'today') {
          startDate = new Date(now.setHours(0, 0, 0, 0));
        } else if (dateFilter === 'week') {
          startDate = new Date(now.setDate(now.getDate() - 7));
        } else {
          startDate = new Date(now.setMonth(now.getMonth() - 1));
        }
        
        query = query.gte('created_at', startDate.toISOString());
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;
      return data;
    }
  });

  // Update order status mutation (via secure edge function)
  const updateStatus = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: OrderStatus }) => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        throw new Error('Not authenticated');
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
        throw new Error(result.message || result.error || 'Failed to update order');
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      showToast('Order status updated', 'success');
    },
    onError: (error: Error) => showToast(error.message || 'Failed to update order', 'error')
  });

  // Refund order mutation
  const refundMutation = useMutation({
    mutationFn: async (order: OrderWithDetails) => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/refund-order`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            order_id: order.id,
            reason: 'Admin initiated refund'
          }),
        }
      );

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to process refund');
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-parents'] });
      setRefundOrder(null);
      showToast('Order refunded successfully. Balance has been restored.', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to process refund', 'error');
    }
  });

  // Filter orders by search
  const filteredOrders = orders?.filter(order => {
    const searchLower = searchQuery.toLowerCase();
    return (
      (order.child?.first_name || '').toLowerCase().includes(searchLower) ||
      (order.child?.last_name || '').toLowerCase().includes(searchLower) ||
      (order.parent?.first_name || '').toLowerCase().includes(searchLower) ||
      (order.parent?.last_name || '').toLowerCase().includes(searchLower) ||
      order.id.toLowerCase().includes(searchLower)
    );
  });

  const getStatusColor = (status: OrderStatus) => {
    const colors: Record<OrderStatus, string> = {
      pending: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
      preparing: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
      ready: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
      completed: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
      cancelled: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
      awaiting_payment: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
    };
    return colors[status];
  };

  const exportOrders = () => {
    if (!filteredOrders) return;
    
    const csv = [
      ['Order ID', 'Date', 'Child', 'Parent', 'Status', 'Total', 'Payment Method'].join(','),
      ...filteredOrders.map(o => [
        o.id,
        format(new Date(o.created_at), 'yyyy-MM-dd HH:mm'),
        `${o.child?.first_name || 'Unknown'} ${o.child?.last_name || 'Student'}`,
        `${o.parent?.first_name || 'Unknown'} ${o.parent?.last_name || ''}`,
        o.status,
        o.total_amount,
        o.payment_method
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orders-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <PageHeader
            title="Order Management"
            subtitle={`${filteredOrders?.length || 0} orders`}
          />
          <div className="flex gap-2">
            <button
              onClick={() => refetch()}
              className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
            >
              <RefreshCw size={20} />
            </button>
            <button
              onClick={exportOrders}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600"
            >
              <Download size={18} />
              Export
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col lg:flex-row gap-4 mb-6">
          {/* Search */}
          <div className="flex-1 relative">
            <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder="Search by name or order ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
          </div>

          {/* Date Filter */}
          <div className="flex gap-2">
            {(['today', 'week', 'month', 'all'] as const).map(range => (
              <button
                key={range}
                onClick={() => setDateFilter(range)}
                className={`px-3 py-2 rounded-lg text-sm font-medium capitalize ${
                  dateFilter === range
                    ? 'bg-primary-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'
                }`}
              >
                {range === 'all' ? 'All Time' : range}
              </button>
            ))}
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as OrderStatus | 'all')}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            <option value="all">All Statuses</option>
            {STATUS_OPTIONS.map(status => (
              <option key={status} value={status} className="capitalize">{status}</option>
            ))}
          </select>
        </div>

        {/* Orders Table */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Order</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Child</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Parent</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Items</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Total</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredOrders?.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                        #{order.id.substring(0, 8)}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {format(new Date(order.created_at), 'MMM d, h:mm a')}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900 dark:text-gray-100">
                        {order.child?.first_name || 'Unknown'} {order.child?.last_name || 'Student'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {order.child?.grade_level || '-'} {order.child?.section && `- ${order.child.section}`}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-900 dark:text-gray-100">
                        {order.parent?.first_name || 'Unknown'} {order.parent?.last_name || ''}
                      </p>
                      {order.parent?.phone_number && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">{order.parent.phone_number}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-700 dark:text-gray-300">
                        {order.items.length} item{order.items.length !== 1 ? 's' : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900 dark:text-gray-100">₱{order.total_amount.toFixed(2)}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{order.payment_method}</p>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={order.status}
                        onChange={(e) => updateStatus.mutate({ 
                          orderId: order.id, 
                          status: e.target.value as OrderStatus 
                        })}
                        className={`px-3 py-1 rounded-full text-xs font-medium border-0 ${getStatusColor(order.status)}`}
                      >
                        {STATUS_OPTIONS.map(status => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setSelectedOrder(order)}
                          className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                          title="View Details"
                        >
                          <Eye size={18} />
                        </button>
                        {order.status !== 'cancelled' && order.status !== 'completed' && (
                          <button
                            onClick={() => setRefundOrder(order)}
                            className="p-2 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/30 rounded-lg"
                            title="Refund Order"
                          >
                            <RotateCcw size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredOrders?.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400">No orders found</p>
            </div>
          )}
        </div>
      </div>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onUpdateStatus={(status) => {
            updateStatus.mutate({ orderId: selectedOrder.id, status });
            setSelectedOrder(null);
          }}
          onRefund={() => {
            setSelectedOrder(null);
            setRefundOrder(selectedOrder);
          }}
        />
      )}

      {/* Refund Confirmation Dialog */}
      {refundOrder && (
        <ConfirmDialog
          isOpen={true}
          title="Confirm Refund"
          message={
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-orange-600">
                <AlertTriangle size={20} />
                <span className="font-medium">This action cannot be undone</span>
              </div>
              <p className="text-gray-600 dark:text-gray-400">
                Refund <span className="font-semibold">₱{refundOrder.total_amount.toFixed(2)}</span> to{' '}
                <span className="font-semibold">{refundOrder.parent.first_name} {refundOrder.parent.last_name}</span>?
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                The order will be cancelled and the amount will be added back to the parent's balance.
              </p>
            </div>
          }
          confirmLabel={refundMutation.isPending ? 'Processing...' : 'Confirm Refund'}
          type="danger"
          onConfirm={() => refundMutation.mutate(refundOrder)}
          onCancel={() => setRefundOrder(null)}
        />
      )}
    </div>
  );
}

// Order Detail Modal
interface OrderDetailModalProps {
  order: OrderWithDetails;
  onClose: () => void;
  onUpdateStatus: (status: OrderStatus) => void;
  onRefund: () => void;
}

function OrderDetailModal({ order, onClose, onUpdateStatus, onRefund }: OrderDetailModalProps) {
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Order Details</h2>
              <span className="text-sm text-gray-500 dark:text-gray-400">#{order.id.substring(0, 8)}</span>
            </div>

            {/* Order Info */}
            <div className="space-y-4 mb-6">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Date</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {format(new Date(order.created_at), 'MMM d, yyyy h:mm a')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Child</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {order.child.first_name} {order.child.last_name}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Grade</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {order.child.grade_level} {order.child.section && `- ${order.child.section}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Parent</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {order.parent.first_name} {order.parent.last_name}
                </span>
              </div>
              {order.parent.phone_number && (
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Phone</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{order.parent.phone_number}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Payment</span>
                <span className="font-medium text-gray-900 dark:text-gray-100 capitalize">{order.payment_method}</span>
              </div>
            </div>

            {/* Order Notes */}
            {order.notes && (
              <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 mb-4">
                <p className="text-sm text-yellow-800 dark:text-yellow-300">📝 {order.notes}</p>
              </div>
            )}

            {/* Items */}
            <div className="border-t border-b border-gray-200 dark:border-gray-700 py-4 mb-4">
              <h3 className="font-semibold mb-3 text-gray-900 dark:text-gray-100">Items</h3>
              <div className="space-y-3">
                {order.items.map((item) => (
                  <div key={item.id} className="flex items-center gap-3">
                    {item.product.image_url && (
                      <img
                        src={item.product.image_url}
                        alt=""
                        className="w-10 h-10 rounded-lg object-cover"
                      />
                    )}
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 dark:text-gray-100">{item.product.name}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        ₱{item.price_at_order.toFixed(2)} × {item.quantity}
                      </p>
                    </div>
                    <p className="font-semibold text-gray-900 dark:text-gray-100">
                      ₱{(item.price_at_order * item.quantity).toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Total */}
            <div className="flex justify-between items-center mb-6">
              <span className="text-lg font-semibold">Total</span>
              <span className="text-2xl font-bold text-primary-600">
                ₱{order.total_amount.toFixed(2)}
              </span>
            </div>

            {/* Status Actions */}
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Update Status</label>
              <div className="grid grid-cols-2 gap-2">
                {STATUS_OPTIONS.filter(s => s !== order.status).map(status => (
                  <button
                    key={status}
                    onClick={() => onUpdateStatus(status)}
                    className={`px-4 py-2 rounded-lg font-medium capitalize ${
                      status === 'cancelled' 
                        ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>

            {/* Refund Button */}
            {order.status !== 'cancelled' && order.status !== 'completed' && (
              <button
                onClick={onRefund}
                className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-2 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded-lg hover:bg-orange-200 dark:hover:bg-orange-900/50 font-medium"
              >
                <RotateCcw size={18} />
                Refund Order
              </button>
            )}

            <button
              onClick={onClose}
              className="w-full mt-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
