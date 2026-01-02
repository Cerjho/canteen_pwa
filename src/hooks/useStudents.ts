import { useQuery } from '@tanstack/react-query';
import { getStudents, getChildren } from '../services/students';
import { useAuth } from './useAuth';

// Primary hook - uses Student type
export function useStudents() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['students', user?.id],
    queryFn: () => getStudents(user!.id),
    enabled: !!user
  });
}

// @deprecated Use useStudents instead - kept for backward compatibility
export function useChildren() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['children', user?.id],
    queryFn: () => getChildren(user!.id),
    enabled: !!user
  });
}