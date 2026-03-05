// useStudents Hook Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';

// Mock useAuth
vi.mock('../../../src/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-user-123' }
  })
}));

// Mock students service
const mockGetStudents = vi.fn();

vi.mock('../../../src/services/students', () => ({
  getStudents: (...args: unknown[]) => mockGetStudents(...args)
}));

import { useStudents } from '../../../src/hooks/useStudents';
import { mockStudents } from '../../mocks/data';

describe('useStudents Hook', () => {
  let queryClient: QueryClient;

  function createWrapper() {
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    };
  }

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
        },
      },
    });
    vi.clearAllMocks();
  });

  describe('Fetching Students', () => {
    it('should fetch students for authenticated user', async () => {
      mockGetStudents.mockResolvedValue(mockStudents);

      const { result } = renderHook(() => useStudents(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockGetStudents).toHaveBeenCalledWith('test-user-123');
      expect(result.current.data).toEqual(mockStudents);
    });

    it('should handle empty students list', async () => {
      mockGetStudents.mockResolvedValue([]);

      const { result } = renderHook(() => useStudents(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual([]);
    });

    it('should set error state on fetch failure', async () => {
      mockGetStudents.mockRejectedValue(new Error('Failed to fetch students'));

      const { result } = renderHook(() => useStudents(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it('should be in loading state initially', () => {
      mockGetStudents.mockImplementation(() => new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useStudents(), {
        wrapper: createWrapper()
      });

      expect(result.current.isLoading).toBe(true);
    });
  });

  describe('Refetch', () => {
    it('should refetch students', async () => {
      mockGetStudents.mockResolvedValue(mockStudents);

      const { result } = renderHook(() => useStudents(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      mockGetStudents.mockClear();

      result.current.refetch();

      await waitFor(() => {
        expect(mockGetStudents).toHaveBeenCalled();
      });
    });
  });
});

// Test without authenticated user
describe('useStudents Hook - Unauthenticated', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
        },
      },
    });
    vi.resetModules();
  });

  it('should not fetch students without user', async () => {
    vi.doMock('../../../src/hooks/useAuth', () => ({
      useAuth: () => ({ user: null })
    }));

    const { useStudents: useStudentsNoAuth } = await import('../../../src/hooks/useStudents');

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    }

    const { result } = renderHook(() => useStudentsNoAuth(), {
      wrapper: Wrapper
    });

    // Query should be disabled without user
    expect(result.current.isLoading).toBe(false);
    expect(mockGetStudents).not.toHaveBeenCalled();
  });
});
