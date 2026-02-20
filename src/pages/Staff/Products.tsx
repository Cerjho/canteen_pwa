import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Package, AlertTriangle, Check, X, RefreshCw } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import type { Product, ProductCategory } from '../../types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const CATEGORIES: ProductCategory[] = ['mains', 'snacks', 'drinks'];

// Debounced stock input component to prevent API call on every keystroke
function StockInput({ productId, initialValue, onUpdate }: {
  productId: string;
  initialValue: number;
  onUpdate: (id: string, stock: number) => void;
}) {
  const [localValue, setLocalValue] = useState(String(initialValue));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setLocalValue(raw);

    // Clear any pending debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Debounce the API call by 600ms
    debounceRef.current = setTimeout(() => {
      const value = parseInt(raw) || 0;
      onUpdate(productId, value);
    }, 600);
  }, [productId, onUpdate]);

  const handleBlur = useCallback(() => {
    // Ensure value is committed on blur even if debounce hasn't fired
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const value = parseInt(localValue) || 0;
    setLocalValue(String(value)); // Normalize display
    onUpdate(productId, value);
  }, [productId, localValue, onUpdate]);

  return (
    <input
      type="number"
      min="0"
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
      className="w-16 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded focus:ring-1 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
    />
  );
}

export default function StaffProducts() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ProductCategory | 'all'>('all');
  const [showOnlyUnavailable, setShowOnlyUnavailable] = useState(false);

  // Fetch products
  const { data: products, isLoading, refetch } = useQuery<Product[]>({
    queryKey: ['staff-products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('name');
      if (error) throw error;
      return data;
    }
  });

  // Toggle availability mutation (via edge function)
  const toggleAvailability = useMutation({
    mutationFn: async ({ id, available }: { id: string; available: boolean }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      const response = await fetch(`${SUPABASE_URL}/functions/v1/staff-product`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'toggle-availability',
          product_id: id,
          available
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Failed to update availability');
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['staff-products'] });
      showToast(result.message || 'Product availability updated', 'success');
    },
    onError: (error: Error) => showToast(error.message || 'Failed to update product', 'error')
  });

  // Update stock mutation (via edge function)
  const updateStock = useMutation({
    mutationFn: async ({ id, stock_quantity }: { id: string; stock_quantity: number }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      const response = await fetch(`${SUPABASE_URL}/functions/v1/staff-product`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'update-stock',
          product_id: id,
          stock_quantity
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Failed to update stock');
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['staff-products'] });
      showToast(result.message || 'Stock updated', 'success');
    },
    onError: (error: Error) => showToast(error.message || 'Failed to update stock', 'error')
  });

  // Stable callback for debounced stock input
  const handleStockUpdate = useCallback((id: string, stock_quantity: number) => {
    updateStock.mutate({ id, stock_quantity });
  }, [updateStock]);

  // Mark all as available (via edge function)
  const markAllAvailable = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      const response = await fetch(`${SUPABASE_URL}/functions/v1/staff-product`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'mark-all-available'
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Failed to update products');
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['staff-products'] });
      showToast(result.message || 'All products marked available', 'success');
    },
    onError: (error: Error) => showToast(error.message || 'Failed to update products', 'error')
  });

  // Filter products
  const filteredProducts = products?.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
    const matchesAvailability = !showOnlyUnavailable || !p.available;
    return matchesSearch && matchesCategory && matchesAvailability;
  });

  // Count unavailable
  const unavailableCount = products?.filter(p => !p.available).length || 0;
  const lowStockCount = products?.filter(p => (p.stock_quantity ?? 0) < 10 && (p.stock_quantity ?? 0) > 0).length || 0;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <PageHeader
            title="Product Availability"
            subtitle="Manage stock and availability"
          />
          <button
            onClick={() => refetch()}
            className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full"
          >
            <RefreshCw size={20} />
          </button>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm text-center">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{products?.filter(p => p.available).length || 0}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Available</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm text-center">
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">{unavailableCount}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Unavailable</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm text-center">
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{lowStockCount}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Low Stock</div>
          </div>
        </div>

        {/* Quick Actions */}
        {unavailableCount > 0 && (
          <button
            onClick={() => markAllAvailable.mutate()}
            disabled={markAllAvailable.isPending}
            className="w-full mb-4 py-2 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-lg flex items-center justify-center gap-2 hover:bg-green-100 dark:hover:bg-green-900/50"
          >
            <Check size={18} />
            Mark All Products Available ({unavailableCount} unavailable)
          </button>
        )}

        {/* Search and Filter */}
        <div className="space-y-3 mb-4">
          <div className="relative">
            <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
          </div>
          
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setCategoryFilter('all')}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap ${
                categoryFilter === 'all' ? 'bg-primary-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'
              }`}
            >
              All
            </button>
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap capitalize ${
                  categoryFilter === cat ? 'bg-primary-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={showOnlyUnavailable}
              onChange={(e) => setShowOnlyUnavailable(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
            />
            Show only unavailable
          </label>
        </div>

        {/* Products List */}
        <div className="space-y-3">
          {filteredProducts?.map(product => (
            <div
              key={product.id}
              className={`bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border-l-4 ${
                product.available ? 'border-green-500' : 'border-red-500'
              }`}
            >
              <div className="flex items-start gap-3">
                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="w-16 h-16 rounded-lg object-cover"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                    <Package size={24} className="text-gray-400" />
                  </div>
                )}
                
                <div className="flex-1">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">{product.name}</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 capitalize">{product.category}</p>
                    </div>
                    <span className="text-lg font-bold text-primary-600 dark:text-primary-400">â‚±{product.price.toFixed(2)}</span>
                  </div>
                  
                  {/* Stock & Availability Controls */}
                  <div className="flex items-center gap-3 mt-3">
                    {/* Stock Input (debounced) */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400">Stock:</span>
                      <StockInput
                        productId={product.id}
                        initialValue={product.stock_quantity ?? 0}
                        onUpdate={handleStockUpdate}
                      />
                    </div>
                    
                    {/* Low Stock Warning */}
                    {(product.stock_quantity ?? 0) < 10 && (product.stock_quantity ?? 0) > 0 && (
                      <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                        <AlertTriangle size={12} />
                        Low
                      </span>
                    )}
                    
                    {/* Availability Toggle */}
                    <button
                      onClick={() => toggleAvailability.mutate({ id: product.id, available: !product.available })}
                      className={`ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium ${
                        product.available
                          ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50'
                          : 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50'
                      }`}
                    >
                      {product.available ? (
                        <>
                          <X size={14} />
                          Mark Unavailable
                        </>
                      ) : (
                        <>
                          <Check size={14} />
                          Mark Available
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          
          {filteredProducts?.length === 0 && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <Package size={48} className="mx-auto mb-2 opacity-50" />
              <p>No products found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
