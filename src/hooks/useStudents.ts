import { useQuery } from '@tanstack/react-query';
import { getStudents, getChildren } from '../services/students';
import { useAuth } from './useAuth';
import type { Student, Child } from '../types';

// Primary hook - uses Student type
export function useStudents() {
  const { user } = useAuth();

  return useQuery<Student[]>({
    queryKey: ['students', user?.id],
    queryFn: async () => {
      if (!user) {
        throw new Error('User not authenticated');
      }
      return getStudents(user.id);
    },
    enabled: !!user
  });
}

/**
 * @deprecated Use useStudents instead - kept for backward compatibility
 */
export function useChildren() {
  const { user } = useAuth();

  return useQuery<Child[]>({
    queryKey: ['children', user?.id],
    queryFn: async () => {
      if (!user) {
        throw new Error('User not authenticated');
      }
      return getChildren(user.id);
    },
    enabled: !!user
  });
}