/* eslint-disable react-refresh/only-export-components */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../services/supabaseClient';
import { useAuth } from '../hooks/useAuth';

// Helper to get today's date in Philippine timezone (UTC+8), matching Dashboard.tsx
function getTodayPH(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

export function useActiveOrderCount() {
  const { user } = useAuth();
  
  const todayStr = getTodayPH();

  const { data: count = 0 } = useQuery({
    queryKey: ['active-order-count', user?.id, todayStr],
    queryFn: async () => {
      // Safety check - should not happen due to enabled flag but TypeScript needs it
      if (!user?.id) return 0;
      
      const { data, error } = await supabase
        .from('orders')
        .select('student_id, scheduled_for')
        .eq('parent_id', user.id)
        .eq('scheduled_for', todayStr)
        .in('status', ['awaiting_payment', 'pending', 'preparing', 'ready']);
      
      if (error) throw error;
      if (!data) return 0;

      // Count distinct (student_id, scheduled_for) pairs to match Dashboard's grouped display
      const groups = new Set(data.map(o => `${o.student_id}_${o.scheduled_for}`));
      return groups.size;
    },
    enabled: !!user?.id, // Only run when user is authenticated
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
