import { useQuery } from '@tanstack/react-query';
import { getStudents } from '../services/students';
import { useAuth } from './useAuth';
import type { Student } from '../types';

export function useStudents() {
  const { user } = useAuth();

  return useQuery<Student[]>({
    queryKey: ['students', user?.id],
    queryFn: async () => {
      if (!user) {
        throw new Error('Please sign in to view students.');
      }
      return getStudents(user.id);
    },
    enabled: !!user
  });
}