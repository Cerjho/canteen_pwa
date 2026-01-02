// useChildren Hook Tests
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

// Mock children service
const mockGetChildren = vi.fn();

vi.mock('../../../src/services/students', () => ({
  getChildren: (...args: unknown[]) => mockGetChildren(...args)
}));

import { useChildren } from '../../../src/hooks/useStudents';
import { mockChildren } from '../../mocks/data';

describe('useChildren Hook', () => {
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

  describe('Fetching Children', () => {
    it('should fetch children for authenticated user', async () => {
      mockGetChildren.mockResolvedValue(mockChildren);

      const { result } = renderHook(() => useChildren(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockGetChildren).toHaveBeenCalledWith('test-user-123');
      expect(result.current.data).toEqual(mockChildren);
    });

    it('should handle empty children list', async () => {
      mockGetChildren.mockResolvedValue([]);

      const { result } = renderHook(() => useChildren(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual([]);
    });

    it('should set error state on fetch failure', async () => {
      mockGetChildren.mockRejectedValue(new Error('Failed to fetch children'));

      const { result } = renderHook(() => useChildren(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it('should be in loading state initially', () => {
      mockGetChildren.mockImplementation(() => new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useChildren(), {
        wrapper: createWrapper()
      });

      expect(result.current.isLoading).toBe(true);
    });
  });

  describe('Refetch', () => {
    it('should refetch children', async () => {
      mockGetChildren.mockResolvedValue(mockChildren);

      const { result } = renderHook(() => useChildren(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      mockGetChildren.mockClear();

      result.current.refetch();

      await waitFor(() => {
        expect(mockGetChildren).toHaveBeenCalled();
      });
    });
  });
});

// Test without authenticated user
describe('useChildren Hook - Unauthenticated', () => {
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

  it('should not fetch children without user', async () => {
    vi.doMock('../../../src/hooks/useAuth', () => ({
      useAuth: () => ({ user: null })
    }));

    const { useChildren: useChildrenNoAuth } = await import('../../../src/hooks/useStudents');

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    }

    const { result } = renderHook(() => useChildrenNoAuth(), {
      wrapper: Wrapper
    });

    // Query should be disabled without user
    expect(result.current.isLoading).toBe(false);
    expect(mockGetChildren).not.toHaveBeenCalled();
  });
});
