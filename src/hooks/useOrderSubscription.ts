import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabaseClient';
import { useAuth } from './useAuth';
import { useToast } from '../components/Toast';

/**
 * Hook to subscribe to realtime order status updates
 * Automatically refreshes order list when status changes
 */
export function useOrderSubscription() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  
  // Use refs for callbacks to avoid re-subscription
  const showToastRef = useRef(showToast);
  const queryClientRef = useRef(queryClient);
  
  // Keep refs updated
  useEffect(() => {
    showToastRef.current = showToast;
    queryClientRef.current = queryClient;
  }, [showToast, queryClient]);

  // Memoized handler to avoid re-creating subscription
  const handleOrderUpdate = useCallback((payload: { new: Record<string, unknown>; old: Record<string, unknown> }) => {
    const newStatus = payload.new?.status as string | undefined;
    const oldStatus = payload.old?.status as string | undefined;
    const newPaymentStatus = payload.new?.payment_status as string | undefined;
    const oldPaymentStatus = payload.old?.payment_status as string | undefined;

    // Show toast notification for status changes
    if (newStatus && newStatus !== oldStatus) {
      const messages: Record<string, string> = {
        pending: '📋 Order confirmed and pending!',
        preparing: '👨‍🍳 Your order is being prepared!',
        ready: '✅ Your order is ready for pickup!',
        completed: '🎉 Order completed!',
        cancelled: '❌ Your order was cancelled'
      };

      if (messages[newStatus]) {
        showToastRef.current(messages[newStatus], newStatus === 'cancelled' ? 'error' : 'success');
      }
    }
    
    // Show toast for payment status changes
    if (newPaymentStatus && newPaymentStatus !== oldPaymentStatus) {
      if (newPaymentStatus === 'paid' && oldPaymentStatus === 'awaiting_payment') {
        showToastRef.current('💰 Payment confirmed!', 'success');
      } else if (newPaymentStatus === 'timeout') {
        showToastRef.current('⏰ Payment expired - order cancelled', 'error');
      } else if (newPaymentStatus === 'refunded') {
        showToastRef.current('💵 Refund processed', 'info');
      }
    }

    // Invalidate orders query to refresh the list
    queryClientRef.current.invalidateQueries({ queryKey: ['orders'] });
    queryClientRef.current.invalidateQueries({ queryKey: ['order-history'] });
    queryClientRef.current.invalidateQueries({ queryKey: ['active-orders'] });
    queryClientRef.current.invalidateQueries({ queryKey: ['scheduled-orders'] });
  }, []);

  useEffect(() => {
    // Only subscribe if user exists and has an ID
    const userId = user?.id;
    if (!userId) return;

    // Subscribe to order changes for this parent
    const channel = supabase
      .channel(`order-updates-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `parent_id=eq.${userId}`
        },
        handleOrderUpdate
      )
      .subscribe((status, err) => {
        if (err) {
          console.error('Order subscription error:', err);
        }
        if (status === 'SUBSCRIBED' && import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.log('Order subscription active for user:', userId);
        }
      });

    // Cleanup on unmount or user change
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, handleOrderUpdate]); // Only re-subscribe when user ID changes
}
