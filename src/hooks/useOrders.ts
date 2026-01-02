import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getOrderHistory, createOrder } from '../services/orders';
import { useAuth } from './useAuth';
import { useToast } from '../components/Toast';
import type { OrderWithDetails } from '../types';

export function useOrders() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const ordersQuery = useQuery<OrderWithDetails[]>({
    queryKey: ['orders', user?.id],
    queryFn: async () => {
      if (!user) {
        throw new Error('User not authenticated');
      }
      return getOrderHistory(user.id);
    },
    enabled: !!user
  });

  const createOrderMutation = useMutation({
    mutationFn: createOrder,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      if (data.queued) {
        showToast('Order saved offline. Will sync when connected.', 'info');
      } else {
        showToast('Order placed successfully!', 'success');
      }
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to place order', 'error');
    }
  });

  return {
    orders: ordersQuery.data,
    isLoading: ordersQuery.isLoading,
    isError: ordersQuery.isError,
    refetch: ordersQuery.refetch,
    createOrder: createOrderMutation.mutate,
    isCreating: createOrderMutation.isPending
  };
}
