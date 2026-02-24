import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getOrderHistory, createOrder } from '../services/orders';
import { supabase } from '../services/supabaseClient';
import { useAuth } from './useAuth';
import { useToast } from '../components/Toast';
import { friendlyError } from '../utils/friendlyError';
import type { OrderWithDetails } from '../types';

export function useOrders() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const ordersQuery = useQuery<OrderWithDetails[]>({
    queryKey: ['orders', user?.id],
    queryFn: async () => {
      if (!user) {
        throw new Error('Please sign in to view orders.');
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
      showToast(friendlyError(error.message, 'place your order'), 'error');
    }
  });

  const markItemUnavailableMutation = useMutation({
    mutationFn: async ({ orderId, itemId }: { orderId: string; itemId: string }) => {
      const { data, error } = await supabase.functions.invoke('manage-order', {
        body: { action: 'mark-item-unavailable', order_id: orderId, item_id: itemId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.message || data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order-history'] });
      queryClient.invalidateQueries({ queryKey: ['staff-orders'] });
      showToast('Item marked as unavailable', 'success');
    },
    onError: (error: Error) => {
      showToast(friendlyError(error.message, 'mark item unavailable'), 'error');
    },
  });

  return {
    orders: ordersQuery.data,
    isLoading: ordersQuery.isLoading,
    isError: ordersQuery.isError,
    refetch: ordersQuery.refetch,
    createOrder: createOrderMutation.mutate,
    isCreating: createOrderMutation.isPending,
    markItemUnavailable: markItemUnavailableMutation.mutate,
    isMarkingUnavailable: markItemUnavailableMutation.isPending,
  };
}
