import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Package, Clock, ChefHat, CheckCircle, XCircle } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { getOrderHistory } from '../../services/orders';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';

export default function OrderHistory() {
  const { user } = useAuth();
  
  const { data: orders, isLoading } = useQuery({
    queryKey: ['order-history', user?.id],
    queryFn: () => getOrderHistory(user!.id),
    enabled: !!user
  });

  const getStatusDetails = (status: string) => {
    switch (status) {
      case 'pending':
        return { 
          icon: Clock, 
          label: 'Pending', 
          color: 'text-gray-600 bg-gray-100' 
        };
      case 'preparing':
        return { 
          icon: ChefHat, 
          label: 'Preparing', 
          color: 'text-yellow-700 bg-yellow-100' 
        };
      case 'ready':
        return { 
          icon: Package, 
          label: 'Ready for Pickup', 
          color: 'text-green-700 bg-green-100' 
        };
      case 'completed':
        return { 
          icon: CheckCircle, 
          label: 'Completed', 
          color: 'text-blue-700 bg-blue-100' 
        };
      case 'cancelled':
        return { 
          icon: XCircle, 
          label: 'Cancelled', 
          color: 'text-red-700 bg-red-100' 
        };
      default:
        return { 
          icon: Clock, 
          label: status, 
          color: 'text-gray-600 bg-gray-100' 
        };
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 bg-gray-50">
      <div className="container mx-auto px-4 py-6">
        <PageHeader
          title="Order History"
          subtitle="View your past orders"
        />

        {!orders || orders.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No orders yet"
            description="Your order history will appear here after you place your first order."
          />
        ) : (
          <div className="space-y-4">
            {orders.map((order: any) => {
              const status = getStatusDetails(order.status);
              const StatusIcon = status.icon;
              
              return (
                <div
                  key={order.id}
                  className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden"
                >
                  {/* Order Header */}
                  <div className="p-4 border-b border-gray-100">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">
                          {format(new Date(order.created_at), 'MMM d, yyyy • h:mm a')}
                        </p>
                        <h3 className="font-semibold text-gray-900">
                          For {order.child?.first_name || 'Unknown'} {order.child?.last_name || 'Student'}
                        </h3>
                      </div>
                      <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${status.color}`}>
                        <StatusIcon size={14} />
                        <span className="text-xs font-medium">{status.label}</span>
                      </div>
                    </div>
                  </div>

                  {/* Order Items */}
                  <div className="p-4">
                    <div className="space-y-2">
                      {order.items.slice(0, 3).map((item: any) => (
                        <div key={item.id} className="flex items-center gap-3">
                          {item.product.image_url && (
                            <img
                              src={item.product.image_url}
                              alt=""
                              className="w-10 h-10 rounded-lg object-cover"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {item.product.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              ₱{item.price_at_order.toFixed(2)} × {item.quantity}
                            </p>
                          </div>
                          <p className="text-sm font-medium text-gray-900">
                            ₱{(item.price_at_order * item.quantity).toFixed(2)}
                          </p>
                        </div>
                      ))}
                      
                      {order.items.length > 3 && (
                        <p className="text-sm text-gray-500 text-center pt-2">
                          +{order.items.length - 3} more item(s)
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Order Footer */}
                  <div className="px-4 py-3 bg-gray-50 flex items-center justify-between">
                    <div>
                      <span className="text-sm text-gray-500">Total</span>
                      <p className="text-lg font-bold text-primary-600">
                        ₱{order.total_amount.toFixed(2)}
                      </p>
                    </div>
                    <div className="text-xs text-gray-500 capitalize">
                      Paid via {order.payment_method || 'cash'}
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
