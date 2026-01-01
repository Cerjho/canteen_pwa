import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShoppingCart, Calendar, CalendarOff, ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format, isToday, isTomorrow } from 'date-fns';
import { getProductsForDate, getCanteenStatus, getWeekdaysWithStatus } from '../../services/products';
import { useChildren } from '../../hooks/useChildren';
import { useFavorites } from '../../hooks/useFavorites';
import { ProductCard } from '../../components/ProductCard';
import { ChildSelector } from '../../components/ChildSelector';
import { CartDrawer } from '../../components/CartDrawer';
import { PageHeader } from '../../components/PageHeader';
import { SearchBar } from '../../components/SearchBar';
import { ProductCardSkeleton } from '../../components/Skeleton';
import { useCart } from '../../hooks/useCart';
import { useToast } from '../../components/Toast';
import type { ProductCategory } from '../../types';

const CATEGORIES: { value: ProductCategory | 'all' | 'favorites'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'favorites', label: '❤️ Favorites' },
  { value: 'mains', label: 'Mains' },
  { value: 'snacks', label: 'Snacks' },
  { value: 'drinks', label: 'Drinks' },
];

// Get friendly date label
function getDateLabel(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  return format(date, 'EEE, MMM d');
}

export default function Menu() {
  const navigate = useNavigate();
  const [cartOpen, setCartOpen] = useState(false);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<ProductCategory | 'all' | 'favorites'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const { showToast } = useToast();
  
  // Get weekdays with status (including holidays)
  const { data: weekdaysInfo } = useQuery({
    queryKey: ['weekdays-with-status'],
    queryFn: () => getWeekdaysWithStatus(5)
  });
  
  // Get selected weekday info for checking holiday status
  const selectedWeekdayInfo = useMemo(() => {
    if (!weekdaysInfo || !selectedDate) return null;
    const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
    return weekdaysInfo.find(w => w.dateStr === selectedDateStr);
  }, [weekdaysInfo, selectedDate]);
  
  // Auto-select first available (non-holiday) date when dates load
  useEffect(() => {
    if (weekdaysInfo && weekdaysInfo.length > 0 && !selectedDate) {
      // Try to select first non-holiday, otherwise first day
      const firstOpen = weekdaysInfo.find(w => w.isOpen);
      setSelectedDate(firstOpen?.date || weekdaysInfo[0].date);
    }
  }, [weekdaysInfo, selectedDate]);
  
  // Use first available date or today as fallback
  const effectiveDate = selectedDate || weekdaysInfo?.[0]?.date || new Date();
  
  // Check canteen status for selected date (use weekdayInfo if available)
  const { data: canteenStatus } = useQuery({
    queryKey: ['canteen-status', effectiveDate.toISOString()],
    queryFn: () => getCanteenStatus(effectiveDate),
    enabled: !!selectedDate && !selectedWeekdayInfo // Skip if we already have weekday info
  });
  
  // Combine status from weekdayInfo or canteenStatus
  const isCanteenOpen = selectedWeekdayInfo ? selectedWeekdayInfo.isOpen : canteenStatus?.isOpen !== false;
  
  // Fetch products for the selected date
  const { data: products, isLoading } = useQuery({
    queryKey: ['products', effectiveDate.toISOString()],
    queryFn: () => getProductsForDate(effectiveDate),
    enabled: !!selectedDate && isCanteenOpen
  });

  const { data: children } = useChildren();
  const { items, addItem, updateQuantity, checkout, total } = useCart();
  const { isFavorite, toggleFavorite, favorites } = useFavorites();

  // Filter products by category and search
  const filteredProducts = useMemo(() => {
    let result = products || [];
    
    // Filter by category
    if (selectedCategory === 'favorites') {
      result = result.filter(p => favorites.includes(p.id));
    } else if (selectedCategory !== 'all') {
      result = result.filter(p => p.category === selectedCategory);
    }
    
    // Filter by search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(p => 
        p.name.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query)
      );
    }
    
    return result;
  }, [products, selectedCategory, searchQuery, favorites]);

  const handleAddToCart = (productId: string) => {
    if (!selectedChildId) {
      showToast('Please select a child first', 'error');
      return;
    }
    
    const product = products?.find(p => p.id === productId);
    if (product) {
      addItem({
        product_id: product.id,
        name: product.name,
        price: product.price,
        image_url: product.image_url,
        quantity: 1
      });
      showToast(`${product.name} added to cart`, 'success');
    }
  };

  const handleCheckout = async (paymentMethod: 'cash' | 'gcash' | 'balance', notes: string) => {
    if (!selectedChildId) {
      showToast('Please select a child', 'error');
      return;
    }

    const selectedChild = children?.find(c => c.id === selectedChildId);
    const scheduledFor = effectiveDate.toISOString().split('T')[0];
    const isFutureOrder = !isToday(effectiveDate);

    try {
      const result = await checkout(selectedChildId, paymentMethod, notes, scheduledFor);
      setCartOpen(false);
      
      // Navigate to confirmation page
      navigate('/order-confirmation', {
        state: {
          orderId: result?.order_id || crypto.randomUUID(),
          totalAmount: total,
          childName: selectedChild ? `${selectedChild.first_name} ${selectedChild.last_name}` : 'Your child',
          itemCount: items.length,
          isOffline: result?.queued || false,
          paymentMethod,
          scheduledFor: isFutureOrder ? scheduledFor : undefined,
          isFutureOrder
        }
      });
    } catch (error) {
      console.error('Checkout error:', error);
      showToast('Failed to place order. Please try again.', 'error');
    }
  };

  // Navigate to next/prev date
  const handlePrevDate = () => {
    if (!weekdaysInfo) return;
    const currentIdx = weekdaysInfo.findIndex(w => 
      w.dateStr === format(effectiveDate, 'yyyy-MM-dd')
    );
    if (currentIdx > 0) {
      setSelectedDate(weekdaysInfo[currentIdx - 1].date);
    }
  };

  const handleNextDate = () => {
    if (!weekdaysInfo) return;
    const currentIdx = weekdaysInfo.findIndex(w => 
      w.dateStr === format(effectiveDate, 'yyyy-MM-dd')
    );
    if (currentIdx < weekdaysInfo.length - 1) {
      setSelectedDate(weekdaysInfo[currentIdx + 1].date);
    }
  };

  // Show canteen closed message for the selected date (holiday)
  if (selectedWeekdayInfo && !selectedWeekdayInfo.isOpen) {
    const currentIdx = weekdaysInfo?.findIndex(w => w.dateStr === format(effectiveDate, 'yyyy-MM-dd')) ?? -1;
    
    return (
      <div className="min-h-screen pb-20">
        <div className="container mx-auto px-4 py-6">
          <PageHeader title="Menu" />
          
          {/* Date selector even when closed - to select another date */}
          <div className="bg-white rounded-xl shadow-sm p-3 mb-4">
            <div className="flex items-center justify-between">
              <button
                onClick={handlePrevDate}
                disabled={currentIdx <= 0}
                className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-30"
              >
                <ChevronLeft size={20} />
              </button>
              <div className="text-center">
                <p className="font-semibold text-gray-900">{getDateLabel(effectiveDate)}</p>
                <p className="text-xs text-gray-500">{format(effectiveDate, 'MMMM d, yyyy')}</p>
              </div>
              <button
                onClick={handleNextDate}
                disabled={!weekdaysInfo || currentIdx >= weekdaysInfo.length - 1}
                className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-30"
              >
                <ChevronRight size={20} />
              </button>
            </div>
            {weekdaysInfo && (
              <div className="flex gap-1 mt-3 overflow-x-auto pb-1">
                {weekdaysInfo.map((dayInfo) => {
                  const isSelected = dayInfo.dateStr === format(effectiveDate, 'yyyy-MM-dd');
                  const isTodayDate = isToday(dayInfo.date);
                  
                  return (
                    <button
                      key={dayInfo.dateStr}
                      onClick={() => setSelectedDate(dayInfo.date)}
                      className={`flex-1 min-w-[60px] px-2 py-2 rounded-lg text-xs font-medium transition-colors relative ${
                        dayInfo.isHoliday
                          ? isSelected
                            ? 'bg-red-600 text-white'
                            : 'bg-red-50 text-red-600 border-2 border-red-200'
                          : isSelected
                          ? 'bg-primary-600 text-white'
                          : isTodayDate
                          ? 'bg-primary-50 text-primary-700 border-2 border-primary-200'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-center gap-1">
                        {dayInfo.isHoliday && <CalendarOff size={10} />}
                        {format(dayInfo.date, 'EEE')}
                      </div>
                      <div className={`text-[10px] ${isSelected ? 'opacity-70' : 'opacity-50'}`}>
                        {format(dayInfo.date, 'd')}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          
          <div className="mt-8 text-center">
            <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CalendarOff size={48} className="text-red-500" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {isToday(effectiveDate) ? 'Canteen Closed Today' : 'Canteen Closed'}
            </h2>
            <p className="text-gray-600 mb-4">
              The canteen is closed for<br />
              <span className="font-semibold text-red-600">{selectedWeekdayInfo.holidayName || 'Holiday'}</span>
            </p>
            <div className="bg-primary-50 border border-primary-100 rounded-xl p-4 max-w-sm mx-auto">
              <p className="text-sm text-primary-800">
                <strong>💡 Tip:</strong> Select a different day above<br />
                to order for other available dates!
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      <div className="container mx-auto px-4 py-6">
        <PageHeader
          title="Menu"
          subtitle={
            <span className="flex items-center gap-1.5">
              <Calendar size={14} className="text-primary-500" />
              {isToday(effectiveDate) ? "Today's Menu" : `Menu for ${format(effectiveDate, 'EEE, MMM d')}`}
            </span>
          }
          action={
            <button
              onClick={() => setCartOpen(true)}
              className="relative p-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              <ShoppingCart size={24} />
              {items.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center">
                  {items.length}
                </span>
              )}
            </button>
          }
        />

        {/* Date Selector for Advance Ordering */}
        <div className="bg-white rounded-xl shadow-sm p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 flex items-center gap-1">
              <Calendar size={16} className="text-primary-500" />
              Order for:
            </span>
            {!isToday(effectiveDate) && (
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                Advance Order
              </span>
            )}
          </div>
          {weekdaysInfo && (
            <div className="flex gap-1 overflow-x-auto pb-1">
              {weekdaysInfo.map((dayInfo) => {
                const isSelected = dayInfo.dateStr === format(effectiveDate, 'yyyy-MM-dd');
                const isTodayDate = isToday(dayInfo.date);
                
                return (
                  <button
                    key={dayInfo.dateStr}
                    onClick={() => setSelectedDate(dayInfo.date)}
                    className={`flex-1 min-w-[60px] px-2 py-2 rounded-lg text-xs font-medium transition-colors relative ${
                      dayInfo.isHoliday
                        ? isSelected
                          ? 'bg-red-600 text-white'
                          : 'bg-red-50 text-red-600 border-2 border-red-200'
                        : isSelected
                        ? 'bg-primary-600 text-white'
                        : isTodayDate
                        ? 'bg-primary-50 text-primary-700 border-2 border-primary-200'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1">
                      {dayInfo.isHoliday && <CalendarOff size={10} />}
                      {isTodayDate ? 'Today' : format(dayInfo.date, 'EEE')}
                    </div>
                    <div className={`text-[10px] ${isSelected ? 'opacity-70' : 'opacity-50'}`}>
                      {format(dayInfo.date, 'd')}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <ChildSelector
          children={children || []}
          selectedChildId={selectedChildId}
          onSelect={setSelectedChildId}
        />

        {/* Category Filter Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setSelectedCategory(cat.value)}
              className={`px-4 py-2 rounded-full font-medium whitespace-nowrap transition-colors ${
                selectedCategory === cat.value
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search Bar */}
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search menu items..."
        />

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[...Array(8)].map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : !products || products.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Calendar size={40} className="text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-800 mb-2">No Menu Available</h3>
            <p className="text-gray-500 max-w-sm mx-auto">
              The menu for {format(effectiveDate, 'EEEE, MMMM d')} hasn't been set yet. 
              Please check back later or try another day.
            </p>
            {weekdaysInfo && weekdaysInfo.length > 1 && (
              <div className="mt-4">
                <p className="text-sm text-gray-600 mb-2">Try ordering for:</p>
                <div className="flex gap-2 justify-center flex-wrap">
                  {weekdaysInfo
                    .filter(w => w.dateStr !== format(effectiveDate, 'yyyy-MM-dd') && w.isOpen)
                    .slice(0, 3)
                    .map(dayInfo => (
                      <button
                        key={dayInfo.dateStr}
                        onClick={() => setSelectedDate(dayInfo.date)}
                        className="px-3 py-1.5 bg-primary-50 text-primary-700 rounded-lg text-sm font-medium hover:bg-primary-100"
                      >
                        {isToday(dayInfo.date) ? 'Today' : format(dayInfo.date, 'EEE, MMM d')}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">
              {searchQuery ? 'No items found matching your search.' : 'No items in this category.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                {...product}
                isFavorite={isFavorite(product.id)}
                onToggleFavorite={() => toggleFavorite(product.id)}
                onAddToCart={handleAddToCart}
              />
            ))}
          </div>
        )}
      </div>

      <CartDrawer
        isOpen={cartOpen}
        onClose={() => setCartOpen(false)}
        items={items}
        onUpdateQuantity={updateQuantity}
        onCheckout={handleCheckout}
      />
    </div>
  );
}