// useProducts Hook Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';

// Mock products service
const mockGetProducts = vi.fn();

vi.mock('../../../src/services/products', () => ({
  getProducts: (...args: any[]) => mockGetProducts(...args)
}));

import { useProducts } from '../../../src/hooks/useProducts';
import { mockProducts } from '../../mocks/data';

describe('useProducts Hook', () => {
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
          staleTime: 0,
        },
      },
    });
    vi.clearAllMocks();
  });

  describe('Fetching Products', () => {
    it('should fetch products on mount', async () => {
      mockGetProducts.mockResolvedValue(mockProducts);

      const { result } = renderHook(() => useProducts(), {
        wrapper: createWrapper()
      });

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockGetProducts).toHaveBeenCalled();
      expect(result.current.products).toEqual(mockProducts);
    });

    it('should return empty array while loading', () => {
      mockGetProducts.mockImplementation(() => new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useProducts(), {
        wrapper: createWrapper()
      });

      expect(result.current.products).toEqual([]);
    });

    it('should handle empty products list', async () => {
      mockGetProducts.mockResolvedValue([]);

      const { result } = renderHook(() => useProducts(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.products).toEqual([]);
    });

    it('should set error state on fetch failure', async () => {
      mockGetProducts.mockRejectedValue(new Error('Failed to fetch products'));

      const { result } = renderHook(() => useProducts(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe('Product Filtering', () => {
    it('should return all products including unavailable ones', async () => {
      mockGetProducts.mockResolvedValue(mockProducts);

      const { result } = renderHook(() => useProducts(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should include the unavailable product
      const unavailable = result.current.products.find(p => !p.available);
      expect(unavailable).toBeDefined();
    });
  });

  describe('Refresh Products', () => {
    it('should refresh products when called', async () => {
      mockGetProducts.mockResolvedValue(mockProducts);

      const { result } = renderHook(() => useProducts(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockGetProducts).toHaveBeenCalledTimes(1);

      // Call refreshProducts
      result.current.refreshProducts();

      await waitFor(() => {
        expect(mockGetProducts).toHaveBeenCalledTimes(2);
      });
    });

    it('should update products after refresh', async () => {
      mockGetProducts.mockResolvedValue(mockProducts);

      const { result } = renderHook(() => useProducts(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Mock new data
      const updatedProducts = [
        ...mockProducts,
        {
          id: 'product-new',
          name: 'New Product',
          description: 'A new product',
          price: 75.00,
          category: 'mains' as const,
          image_url: 'https://example.com/new.jpg',
          available: true,
          stock_quantity: 10,
          created_at: '2024-01-02T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z'
        }
      ];
      mockGetProducts.mockResolvedValue(updatedProducts);

      result.current.refreshProducts();

      await waitFor(() => {
        expect(result.current.products).toHaveLength(mockProducts.length + 1);
      });
    });
  });

  describe('Refetch', () => {
    it('should expose refetch function', async () => {
      mockGetProducts.mockResolvedValue(mockProducts);

      const { result } = renderHook(() => useProducts(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(typeof result.current.refetch).toBe('function');
    });

    it('should refetch when called', async () => {
      mockGetProducts.mockResolvedValue(mockProducts);

      const { result } = renderHook(() => useProducts(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      mockGetProducts.mockClear();
      
      result.current.refetch();

      await waitFor(() => {
        expect(mockGetProducts).toHaveBeenCalled();
      });
    });
  });

  describe('Caching', () => {
    it('should use cached data on subsequent renders', async () => {
      mockGetProducts.mockResolvedValue(mockProducts);

      const { result, rerender } = renderHook(() => useProducts(), {
        wrapper: createWrapper()
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockGetProducts).toHaveBeenCalledTimes(1);

      // Rerender should use cached data
      rerender();

      expect(mockGetProducts).toHaveBeenCalledTimes(1);
      expect(result.current.products).toEqual(mockProducts);
    });
  });
});
