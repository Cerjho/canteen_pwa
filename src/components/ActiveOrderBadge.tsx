import { useQuery } from '@tanstack/react-query';
import { supabase } from '../services/supabaseClient';
import { useAuth } from '../hooks/useAuth';

export function useActiveOrderCount() {
  const { user } = useAuth();
  
  const { data: count = 0 } = useQuery({
    queryKey: ['active-order-count', user?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('parent_id', user!.id)
        .in('status', ['pending', 'preparing', 'ready']);
      
      if (error) throw error;
      return count || 0;
    },
    enabled: !!user,
    refetchInterval: 30000 // Refresh every 30 seconds
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
