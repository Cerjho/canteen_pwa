/* eslint-disable react-refresh/only-export-components */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../services/supabaseClient';
import { useAuth } from '../hooks/useAuth';

export function useActiveOrderCount() {
  const { user } = useAuth();

  const { data: count = 0 } = useQuery({
    queryKey: ['active-order-count', user?.id],
    queryFn: async () => {
      if (!user?.id) return 0;

      // Count active weekly orders (submitted, paid, partially_cancelled)
      const { data, error } = await supabase
        .from('weekly_orders')
        .select('id')
        .eq('parent_id', user.id)
        .in('status', ['submitted', 'paid', 'partially_cancelled']);

      if (error) throw error;
      return data?.length ?? 0;
    },
    enabled: !!user?.id,
    refetchInterval: 30000,
  });

  return count;
}

interface ActiveOrderBadgeProps {
  className?: string;
}

export function ActiveOrderBadge({ className = '' }: ActiveOrderBadgeProps) {
  const count = useActiveOrderCount();
  
  if (count === 0) return null;
  
  return (
    <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold text-white bg-red-500 rounded-full ${className}`}>
      {count > 9 ? '9+' : count}
    </span>
  );
}
