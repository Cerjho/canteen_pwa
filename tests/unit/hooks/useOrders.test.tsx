// useOrders Hook Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';

// Mock toast
const mockShowToast = vi.fn();
vi.mock('../../../src/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast })
}));

// Mock useAuth
vi.mock('../../../src/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-user-123' }
  })
}));

// Mock orders service
const mockGetOrderHistory = vi.fn();
const mockCreateOrder = vi.fn();

vi.mock('../../../src/services/orders', () => ({
  getOrderHistory: (...args: unknown[]) => mockGetOrderHistory(...args),
  createOrder: (...args: unknown[]) => mockCreateOrder(...args)
}));

import { useOrders } from '../../../src/hooks/useOrders';
import { mockOrders } from '../../mocks/data';

describe('useOrders Hook', () => {
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
        mutations: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
    mockShowToast.mockClear();
  });

  describe('Fetching Orders', () => {
    it('should fetch orders for authenticated user', async () => {
      mockGetOrderHistory.mockResolvedValue(mockOrders);

      const { result } = renderHook(() => useOrders(), {
        wrapper: createWrapper()
      });

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockGetOrderHistory).toHaveBeenCalledWith('test-user-123');
      expect(result.current.orders).toEqual(mockOrders);
    });

    it('should handle empty orders list', async () => {
      mockGetOrderHistory.mockResolvedValue([]);

      const { result } = renderHook(() => useOrders(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.orders).toEqual([]);
    });

    it('should set error state on fetch failure', async () => {
      mockGetOrderHistory.mockRejectedValue(new Error('Failed to fetch'));

      const { result } = renderHook(() => useOrders(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe('Creating Orders', () => {
    it('should create order successfully', async () => {
      mockGetOrderHistory.mockResolvedValue([]);
      mockCreateOrder.mockResolvedValue({ id: 'new-order-1', status: 'pending' });

      const { result } = renderHook(() => useOrders(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      result.current.createOrder({
        parent_id: 'test-user-123',
        student_id: 'child-1',
        client_order_id: 'client-1',
        items: [{ product_id: 'product-1', quantity: 1, price_at_order: 65 }],
        payment_method: 'cash'
      });

      await waitFor(() => {
        expect(mockCreateOrder).toHaveBeenCalled();
      });
    });

    it('should show success toast after creating order', async () => {
      mockGetOrderHistory.mockResolvedValue([]);
      mockCreateOrder.mockResolvedValue({ id: 'new-order-1' });

      const { result } = renderHook(() => useOrders(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      result.current.createOrder({
        parent_id: 'test-user-123',
        student_id: 'child-1',
        client_order_id: 'client-1',
        items: [{ product_id: 'product-1', quantity: 1, price_at_order: 65 }],
        payment_method: 'cash'
      });

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          'Order placed successfully!',
          'success'
        );
      });
    });

    it('should show offline toast when order is queued', async () => {
      mockGetOrderHistory.mockResolvedValue([]);
      mockCreateOrder.mockResolvedValue({ queued: true });

      const { result } = renderHook(() => useOrders(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      result.current.createOrder({
        parent_id: 'test-user-123',
        student_id: 'child-1',
        client_order_id: 'client-1',
        items: [{ product_id: 'product-1', quantity: 1, price_at_order: 65 }],
        payment_method: 'cash'
      });

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          'Order saved offline. Will sync when connected.',
          'info'
        );
      });
    });

    it('should show error toast on create failure', async () => {
      mockGetOrderHistory.mockResolvedValue([]);
      mockCreateOrder.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useOrders(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      result.current.createOrder({
        parent_id: 'test-user-123',
        student_id: 'child-1',
        client_order_id: 'client-1',
        items: [{ product_id: 'product-1', quantity: 1, price_at_order: 65 }],
        payment_method: 'cash'
      });

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          'Network error',
          'error'
        );
      });
    });

    it('should set isCreating state during mutation', async () => {
      mockGetOrderHistory.mockResolvedValue([]);
      
      let resolveCreate: ((value: { id: string }) => void) | undefined;
      mockCreateOrder.mockImplementation(() => new Promise((resolve) => {
        resolveCreate = resolve;
      }));

      const { result } = renderHook(() => useOrders(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      result.current.createOrder({
        parent_id: 'test-user-123',
        student_id: 'child-1',
        client_order_id: 'client-1',
        items: [{ product_id: 'product-1', quantity: 1, price_at_order: 65 }],
        payment_method: 'cash'
      });

      await waitFor(() => {
        expect(result.current.isCreating).toBe(true);
      });

      if (resolveCreate) {
        resolveCreate({ id: 'new-order' });
      }

      await waitFor(() => {
        expect(result.current.isCreating).toBe(false);
      });
    });
  });

  describe('Refetch', () => {
    it('should refetch orders', async () => {
      mockGetOrderHistory.mockResolvedValue(mockOrders);

      const { result } = renderHook(() => useOrders(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      mockGetOrderHistory.mockClear();

      result.current.refetch();

      await waitFor(() => {
        expect(mockGetOrderHistory).toHaveBeenCalled();
      });
    });
  });
});

// Test without authenticated user
describe('useOrders Hook - Unauthenticated', () => {
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

  it('should not fetch orders without user', async () => {
    vi.doMock('../../../src/hooks/useAuth', () => ({
      useAuth: () => ({ user: null })
    }));

    const { useOrders: useOrdersNoAuth } = await import('../../../src/hooks/useOrders');

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    }

    const { result } = renderHook(() => useOrdersNoAuth(), {
      wrapper: Wrapper
    });

    // Should not be loading since query is disabled
    expect(result.current.isLoading).toBe(false);
    expect(mockGetOrderHistory).not.toHaveBeenCalled();
  });
});
