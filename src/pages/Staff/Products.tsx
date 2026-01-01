import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Package, AlertTriangle, Check, X, RefreshCw } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import type { Product, ProductCategory } from '../../types';

const CATEGORIES: ProductCategory[] = ['mains', 'snacks', 'drinks'];

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

  // Toggle availability mutation
  const toggleAvailability = useMutation({
    mutationFn: async ({ id, available }: { id: string; available: boolean }) => {
      const { error } = await supabase
        .from('products')
        .update({ available, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, { available }) => {
      queryClient.invalidateQueries({ queryKey: ['staff-products'] });
      showToast(available ? 'Product marked available' : 'Product marked unavailable', 'success');
    },
    onError: () => showToast('Failed to update product', 'error')
  });

  // Update stock mutation
  const updateStock = useMutation({
    mutationFn: async ({ id, stock_quantity }: { id: string; stock_quantity: number }) => {
      const { error } = await supabase
        .from('products')
        .update({ stock_quantity, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-products'] });
      showToast('Stock updated', 'success');
    },
    onError: () => showToast('Failed to update stock', 'error')
  });

  // Mark all as available
  const markAllAvailable = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('products')
        .update({ available: true, updated_at: new Date().toISOString() })
        .eq('available', false);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-products'] });
      showToast('All products marked available', 'success');
    },
    onError: () => showToast('Failed to update products', 'error')
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
    <div className="min-h-screen pb-20 bg-gray-50">
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <PageHeader
            title="Product Availability"
            subtitle="Manage stock and availability"
          />
          <button
            onClick={() => refetch()}
            className="p-2 text-gray-600 hover:bg-gray-200 rounded-full"
          >
            <RefreshCw size={20} />
          </button>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-white rounded-lg p-4 shadow-sm text-center">
            <div className="text-2xl font-bold text-green-600">{products?.filter(p => p.available).length || 0}</div>
            <div className="text-xs text-gray-500">Available</div>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm text-center">
            <div className="text-2xl font-bold text-red-600">{unavailableCount}</div>
            <div className="text-xs text-gray-500">Unavailable</div>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm text-center">
            <div className="text-2xl font-bold text-amber-600">{lowStockCount}</div>
            <div className="text-xs text-gray-500">Low Stock</div>
          </div>
        </div>

        {/* Quick Actions */}
        {unavailableCount > 0 && (
          <button
            onClick={() => markAllAvailable.mutate()}
            disabled={markAllAvailable.isPending}
            className="w-full mb-4 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg flex items-center justify-center gap-2 hover:bg-green-100"
          >
            <Check size={18} />
            Mark All Products Available ({unavailableCount} unavailable)
          </button>
        )}

        {/* Search and Filter */}
        <div className="space-y-3 mb-4">
          <div className="relative">
            <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setCategoryFilter('all')}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap ${
                categoryFilter === 'all' ? 'bg-primary-600 text-white' : 'bg-white text-gray-700'
              }`}
            >
              All
            </button>
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap capitalize ${
                  categoryFilter === cat ? 'bg-primary-600 text-white' : 'bg-white text-gray-700'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={showOnlyUnavailable}
              onChange={(e) => setShowOnlyUnavailable(e.target.checked)}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            Show only unavailable
          </label>
        </div>

        {/* Products List */}
        <div className="space-y-3">
          {filteredProducts?.map(product => (
            <div
              key={product.id}
              className={`bg-white rounded-lg p-4 shadow-sm border-l-4 ${
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
                  <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center">
                    <Package size={24} className="text-gray-400" />
                  </div>
                )}
                
                <div className="flex-1">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold">{product.name}</h3>
                      <p className="text-sm text-gray-500 capitalize">{product.category}</p>
                    </div>
                    <span className="text-lg font-bold text-primary-600">₱{product.price.toFixed(2)}</span>
                  </div>
                  
                  {/* Stock & Availability Controls */}
                  <div className="flex items-center gap-3 mt-3">
                    {/* Stock Input */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">Stock:</span>
                      <input
                        type="number"
                        min="0"
                        value={product.stock_quantity ?? 0}
                        onChange={(e) => {
                          const value = parseInt(e.target.value) || 0;
                          updateStock.mutate({ id: product.id, stock_quantity: value });
                        }}
                        className="w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500"
                      />
                    </div>
                    
                    {/* Low Stock Warning */}
                    {(product.stock_quantity ?? 0) < 10 && (product.stock_quantity ?? 0) > 0 && (
                      <span className="flex items-center gap-1 text-xs text-amber-600">
                        <AlertTriangle size={12} />
                        Low
                      </span>
                    )}
                    
                    {/* Availability Toggle */}
                    <button
                      onClick={() => toggleAvailability.mutate({ id: product.id, available: !product.available })}
                      className={`ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium ${
                        product.available
                          ? 'bg-red-50 text-red-600 hover:bg-red-100'
                          : 'bg-green-50 text-green-600 hover:bg-green-100'
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
            <div className="text-center py-8 text-gray-500">
              <Package size={48} className="mx-auto mb-2 opacity-50" />
              <p>No products found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
