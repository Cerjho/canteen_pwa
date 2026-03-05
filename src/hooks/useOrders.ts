import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getOrderHistory,
  getWeeklyOrders,
  getWeeklyOrderDetail,
  createWeeklyOrder,
  createSurplusOrder,
  cancelDayFromWeeklyOrder,
} from '../services/orders';
import { supabase } from '../services/supabaseClient';
import { useAuth } from './useAuth';
import { useToast } from '../components/Toast';
import { friendlyError } from '../utils/friendlyError';
import type { OrderWithDetails, WeeklyOrderWithDetails, CreateWeeklyOrderRequest, CreateSurplusOrderRequest } from '../types';

/**
 * Hook for daily order history and order management actions.
 */
export function useOrders() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const ordersQuery = useQuery<OrderWithDetails[]>({
    queryKey: ['orders', user?.id],
    queryFn: async () => {
      if (!user) throw new Error('Please sign in to view orders.');
      return getOrderHistory(user.id);
    },
    enabled: !!user,
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
      queryClient.invalidateQueries({ queryKey: ['weekly-orders'] });
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
    markItemUnavailable: markItemUnavailableMutation.mutate,
    isMarkingUnavailable: markItemUnavailableMutation.isPending,
  };
}

/**
 * Hook for weekly orders — paginated list for parent dashboard/history.
 */
export function useWeeklyOrders(page = 0) {
  const { user } = useAuth();

  return useQuery<WeeklyOrderWithDetails[]>({
    queryKey: ['weekly-orders', user?.id, page],
    queryFn: async () => {
      if (!user) throw new Error('Please sign in to view orders.');
      return getWeeklyOrders(user.id, page);
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}

/**
 * Hook for a single weekly order with full daily breakdown.
 */
export function useWeeklyOrderDetail(weeklyOrderId: string | null) {
  return useQuery<WeeklyOrderWithDetails | null>({
    queryKey: ['weekly-order-detail', weeklyOrderId],
    queryFn: async () => {
      if (!weeklyOrderId) return null;
      return getWeeklyOrderDetail(weeklyOrderId);
    },
    enabled: !!weeklyOrderId,
    staleTime: 1000 * 60,
  });
}

/**
 * Hook for staff: today's pre-orders (daily orders from weekly pre-orders).
 */
export function useTodaysPreOrders() {
  return useQuery<OrderWithDetails[]>({
    queryKey: ['staff-orders', 'today-preorders'],
    queryFn: async () => {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          student:students!orders_student_id_fkey(id, first_name, last_name),
          items:order_items(
            *,
            product:products(name, image_url)
          )
        `)
        .eq('scheduled_for', today)
        .eq('order_type', 'pre_order')
        .not('status', 'eq', 'cancelled')
        .order('created_at', { ascending: true });

      if (error) throw error;
      return (data || []) as OrderWithDetails[];
    },
    staleTime: 1000 * 30, // 30 seconds (staff needs near-real-time)
    refetchInterval: 1000 * 60, // auto-refetch every minute
  });
}

/**
 * Mutation hook: create a weekly pre-order (cash).
 */
export function useCreateWeeklyOrder() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: (req: CreateWeeklyOrderRequest) => createWeeklyOrder(req),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['weekly-orders'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      showToast(data.message || 'Weekly order placed!', 'success');
    },
    onError: (error: Error) => {
      showToast(friendlyError(error.message, 'place weekly order'), 'error');
    },
  });
}

/**
 * Mutation hook: create a surplus order.
 */
export function useCreateSurplusOrder() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: (req: CreateSurplusOrderRequest) => createSurplusOrder(req),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['surplus-items'] });
      showToast(data.message || 'Surplus order placed!', 'success');
    },
    onError: (error: Error) => {
      showToast(friendlyError(error.message, 'place surplus order'), 'error');
    },
  });
}

/**
 * Mutation hook: cancel an individual day from a weekly order.
 */
export function useCancelDay() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason?: string }) =>
      cancelDayFromWeeklyOrder(orderId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekly-orders'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      showToast('Day cancelled successfully. Refund will be processed.', 'success');
    },
    onError: (error: Error) => {
      showToast(friendlyError(error.message, 'cancel this day'), 'error');
    },
  });
}
