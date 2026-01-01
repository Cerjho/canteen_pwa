import { useEffect } from 'react';
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

  useEffect(() => {
    if (!user) return;

    // Subscribe to order changes for this parent
    const channel = supabase
      .channel('order-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `parent_id=eq.${user.id}`
        },
        (payload) => {
          const newStatus = payload.new.status;
          const oldStatus = payload.old.status;

          // Show toast notification for status changes
          if (newStatus !== oldStatus) {
            const messages: Record<string, string> = {
              preparing: '👨‍🍳 Your order is being prepared!',
              ready: '✅ Your order is ready for pickup!',
              completed: '🎉 Order completed!',
              cancelled: '❌ Your order was cancelled'
            };

            if (messages[newStatus]) {
              showToast(messages[newStatus], newStatus === 'cancelled' ? 'error' : 'success');
            }
          }

          // Invalidate orders query to refresh the list
          queryClient.invalidateQueries({ queryKey: ['orders'] });
        }
      )
      .subscribe();

    // Cleanup on unmount
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient, showToast]);
}
