import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getProducts, getMenuForWeek, getSurplusItems, Product } from '../services/products';
import type { SurplusItem } from '../types';

export function useProducts() {
  const queryClient = useQueryClient();

  const productsQuery = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: getProducts,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const refreshProducts = () => {
    queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  return {
    products: productsQuery.data || [],
    isLoading: productsQuery.isLoading,
    isError: productsQuery.isError,
    error: productsQuery.error,
    refetch: productsQuery.refetch,
    refreshProducts
  };
}

/**
 * Hook: fetch entire week's menu (Mon–Fri) for a given week start date.
 * Returns a Map<string, Product[]> keyed by date string.
 */
export function useWeekMenu(weekStart: string | null) {
  return useQuery<Map<string, Product[]>>({
    queryKey: ['week-menu', weekStart],
    queryFn: async () => {
      if (!weekStart) return new Map();
      return getMenuForWeek(weekStart);
    },
    enabled: !!weekStart,
    staleTime: 1000 * 60 * 10, // 10 minutes — menu doesn't change often
  });
}

/**
 * Hook: fetch today's surplus items with product details.
 */
export function useSurplusItems() {
  return useQuery<SurplusItem[]>({
    queryKey: ['surplus-items'],
    queryFn: getSurplusItems,
    staleTime: 1000 * 30, // 30 seconds — surplus availability changes quickly
    refetchInterval: 1000 * 60, // auto-refetch every minute
  });
}
