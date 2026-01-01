import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getProducts, Product } from '../services/products';

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
    refetch: productsQuery.refetch,
    refreshProducts
  };
}
