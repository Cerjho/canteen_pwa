import { useQuery } from '@tanstack/react-query';
import { getChildren } from '../services/children';
import { useAuth } from './useAuth';

export function useChildren() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['children', user?.id],
    queryFn: () => getChildren(user!.id),
    enabled: !!user
  });
}