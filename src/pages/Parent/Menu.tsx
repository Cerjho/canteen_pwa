import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart, Calendar, CalendarOff, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format, isToday, isTomorrow } from 'date-fns';
import { getProductsForDate, getCanteenStatus, getWeekdaysWithStatus, formatDateLocal } from '../../services/products';
import { useStudents } from '../../hooks/useStudents';
import { useFavorites } from '../../hooks/useFavorites';
import { ProductCard } from '../../components/ProductCard';
import { StudentSelector } from '../../components/StudentSelector';
import { CartDrawer } from '../../components/CartDrawer';
import { PageHeader } from '../../components/PageHeader';
import { SearchBar } from '../../components/SearchBar';
import { ProductCardSkeleton } from '../../components/Skeleton';
import { WeeklyCartSummary } from '../../components/WeeklyCartSummary';
import { useCart } from '../../hooks/useCart';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';
import type { ProductCategory, MealPeriod, PaymentMethod } from '../../types';
import { friendlyError } from '../../utils/friendlyError';
import { autoMealPeriod, MEAL_PERIOD_LABELS, MEAL_PERIOD_ICONS } from '../../types';

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
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [cartOpen, setCartOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<ProductCategory | 'all' | 'favorites'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [snackPopup, setSnackPopup] = useState<{ productId: string } | null>(null);
  const { showToast } = useToast();

  // Cart hook now manages selectedStudentId
  const { 
    items, 
    itemsByStudent, 
    itemsByDateAndStudent,
    addItem, 
    updateQuantity, 
    checkout, 
    selectedStudentId, 
    setSelectedStudentId,
    clearDate,
    copyDateItems,
    summary
  } = useCart();
  const { isFavorite, toggleFavorite, favorites } = useFavorites();
  const { data: students } = useStudents();

  // Fetch parent wallet balance
  const { data: walletData } = useQuery({
    queryKey: ['parent-wallet', user?.id],
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');
      const { data, error } = await supabase
        .from('wallets')
        .select('balance')
        .eq('user_id', user.id)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id
  });

  const parentBalance = walletData?.balance || 0;
  
  // Get weekdays with status (including holidays)
  const { data: weekdaysInfo } = useQuery({
    queryKey: ['weekdays-with-status'],
    queryFn: () => getWeekdaysWithStatus(5)
  });
  
  // Get selected weekday info for checking holiday status
  const selectedWeekdayInfo = useMemo(() => {
    if (!weekdaysInfo || !selectedDate) return null;
    const selectedDateStr = formatDateLocal(selectedDate);
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
  
  // Use first available date or today as fallback - memoize to prevent useCallback dependency issues
  const effectiveDate = useMemo(
    () => selectedDate || weekdaysInfo?.[0]?.date || new Date(),
    [selectedDate, weekdaysInfo]
  );
  
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
        (p.description?.toLowerCase().includes(query) ?? false)
      );
    }
    
    return result;
  }, [products, selectedCategory, searchQuery, favorites]);

  // Memoize handlers to prevent unnecessary re-renders
  const handleAddToCart = useCallback((productId: string) => {
    if (!selectedStudentId) {
      showToast('Please select a child first', 'error');
      return;
    }
    
    const product = products?.find(p => p.id === productId);
    if (!product) return;

    // Auto-assign meal period for mains/drinks, prompt for snacks
    const mealPeriod = autoMealPeriod(product.category as ProductCategory);
    if (mealPeriod === null) {
      // Snack — show popup to let parent choose morning or afternoon
      setSnackPopup({ productId });
      return;
    }

    const selectedStudent = students?.find(s => s.id === selectedStudentId);
    const scheduledFor = formatDateLocal(effectiveDate);
    
    if (selectedStudent) {
      addItem({
        product_id: product.id,
        student_id: selectedStudentId,
        student_name: `${selectedStudent.first_name} ${selectedStudent.last_name}`,
        name: product.name,
        price: product.price,
        image_url: product.image_url,
        quantity: 1,
        scheduled_for: scheduledFor,
        meal_period: mealPeriod
      });
      showToast(`${product.name} added for ${selectedStudent.first_name}`, 'success');
    }
  }, [selectedStudentId, students, products, addItem, showToast, effectiveDate]);

  // Handle snack meal period selection from popup
  const handleSnackMealSelect = useCallback((mealPeriod: MealPeriod) => {
    if (!snackPopup || !selectedStudentId) return;

    const product = products?.find(p => p.id === snackPopup.productId);
    const selectedStudent = students?.find(s => s.id === selectedStudentId);
    const scheduledFor = formatDateLocal(effectiveDate);

    if (product && selectedStudent) {
      addItem({
        product_id: product.id,
        student_id: selectedStudentId,
        student_name: `${selectedStudent.first_name} ${selectedStudent.last_name}`,
        name: product.name,
        price: product.price,
        image_url: product.image_url,
        quantity: 1,
        scheduled_for: scheduledFor,
        meal_period: mealPeriod
      });
      showToast(`${product.name} added for ${selectedStudent.first_name} (${MEAL_PERIOD_LABELS[mealPeriod]})`, 'success');
    }

    setSnackPopup(null);
  }, [snackPopup, selectedStudentId, products, students, addItem, showToast, effectiveDate]);

  const handleCheckout = useCallback(async (paymentMethod: PaymentMethod, notes: string, selectedDates?: string[]) => {
    if (items.length === 0) {
      showToast('Cart is empty', 'error');
      return;
    }

    // Filter items for checkout (if selectedDates provided)
    const itemsToCheckout = selectedDates && selectedDates.length > 0
      ? items.filter(i => selectedDates.includes(i.scheduled_for))
      : items;

    // Get unique scheduled dates from items to checkout
    const scheduledDates = [...new Set(itemsToCheckout.map(i => i.scheduled_for))];
    const hasFutureOrders = scheduledDates.some(d => d !== formatDateLocal(new Date()));

    try {
      // Each item has its own scheduled_for date, checkout groups by student+date
      const result = await checkout(paymentMethod, notes, selectedDates);
      setCartOpen(false);
      
      // Invalidate wallet balance if paid with balance
      if (paymentMethod === 'balance') {
        queryClient.invalidateQueries({ queryKey: ['parent-wallet'] });
        queryClient.invalidateQueries({ queryKey: ['parent-balance'] });
      }
      
      // Get student names for confirmation
      const studentNames = [...new Set(itemsToCheckout.map(i => i.student_name))].join(', ');
      const checkoutTotal = itemsToCheckout.reduce((sum, i) => sum + i.price * i.quantity, 0);
      
      // Navigate to confirmation page
      navigate('/order-confirmation', {
        state: {
          orderId: result?.orders?.[0]?.order_id || crypto.randomUUID(),
          orderCount: result?.orders?.length || 1,
          totalAmount: checkoutTotal,
          childName: studentNames || 'Your children',
          itemCount: itemsToCheckout.length,
          isOffline: false,
          paymentMethod,
          scheduledDates: scheduledDates,
          isFutureOrder: hasFutureOrders
        }
      });
    } catch (error) {
      console.error('Checkout error:', error);
      // Show the actual error from the backend instead of a generic message
      const msg = error instanceof Error
        ? friendlyError(error.message, 'place your order')
        : 'Something went wrong. Please try again.';
      showToast(msg, 'error');
      // Re-throw so CartDrawer can also display inline error
      throw error;
    }
  }, [items, checkout, queryClient, navigate, showToast]);

  // Navigate to next/prev date
  const handlePrevDate = useCallback(() => {
    if (!weekdaysInfo) return;
    const currentIdx = weekdaysInfo.findIndex(w => 
      w.dateStr === formatDateLocal(effectiveDate)
    );
    if (currentIdx > 0) {
      setSelectedDate(weekdaysInfo[currentIdx - 1].date);
    }
  }, [weekdaysInfo, effectiveDate]);

  const handleNextDate = useCallback(() => {
    if (!weekdaysInfo) return;
    const currentIdx = weekdaysInfo.findIndex(w => 
      w.dateStr === formatDateLocal(effectiveDate)
    );
    if (currentIdx < weekdaysInfo.length - 1) {
      setSelectedDate(weekdaysInfo[currentIdx + 1].date);
    }
  }, [weekdaysInfo, effectiveDate]);

  // Show canteen closed message for the selected date (holiday)
  if (selectedWeekdayInfo && !selectedWeekdayInfo.isOpen) {
    const currentIdx = weekdaysInfo?.findIndex(w => w.dateStr === formatDateLocal(effectiveDate)) ?? -1;
    
    return (
      <div className="min-h-screen pb-20">
        <div className="container mx-auto px-4 py-6">
          <PageHeader title="Menu" />
          
          {/* Date selector even when closed - to select another date */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-3 mb-4">
            <div className="flex items-center justify-between">
              <button
                onClick={handlePrevDate}
                disabled={currentIdx <= 0}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg disabled:opacity-30"
              >
                <ChevronLeft size={20} />
              </button>
              <div className="text-center">
                <p className="font-semibold text-gray-900 dark:text-gray-100">{getDateLabel(effectiveDate)}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{format(effectiveDate, 'MMMM d, yyyy')}</p>
              </div>
              <button
                onClick={handleNextDate}
                disabled={!weekdaysInfo || currentIdx >= weekdaysInfo.length - 1}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg disabled:opacity-30"
              >
                <ChevronRight size={20} />
              </button>
            </div>
            {weekdaysInfo && (
              <div className="flex gap-1 mt-3 overflow-x-auto pb-1">
                {weekdaysInfo.map((dayInfo) => {
                  const isSelected = dayInfo.dateStr === formatDateLocal(effectiveDate);
                  const isTodayDate = isToday(dayInfo.date);
                  
                  return (
                    <button
                      key={dayInfo.dateStr}
                      onClick={() => setSelectedDate(dayInfo.date)}
                      className={`flex-1 min-w-[60px] px-2 py-2 rounded-lg text-xs font-medium transition-colors relative ${
                        dayInfo.isHoliday
                          ? isSelected
                            ? 'bg-red-600 text-white'
                            : 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-2 border-red-200 dark:border-red-800'
                          : dayInfo.isMakeupDay
                          ? isSelected
                            ? 'bg-emerald-600 text-white'
                            : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-2 border-emerald-200 dark:border-emerald-800'
                          : isSelected
                          ? 'bg-primary-600 text-white'
                          : isTodayDate
                          ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 border-2 border-primary-200 dark:border-primary-800'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      <div className="flex items-center justify-center gap-1">
                        {dayInfo.isHoliday && <CalendarOff size={10} />}
                        {dayInfo.isMakeupDay && <CalendarDays size={10} />}
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
            <div className="w-24 h-24 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <CalendarOff size={48} className="text-red-500 dark:text-red-400" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              {isToday(effectiveDate) ? 'Canteen Closed Today' : 'Canteen Closed'}
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              The canteen is closed for<br />
              <span className="font-semibold text-red-600 dark:text-red-400">{selectedWeekdayInfo.holidayName || 'Holiday'}</span>
            </p>
            <div className="bg-primary-50 dark:bg-primary-900/30 border border-primary-100 dark:border-primary-800 rounded-xl p-4 max-w-sm mx-auto">
              <p className="text-sm text-primary-800 dark:text-primary-300">
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
    <div className="min-h-screen pb-20 bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-6">
        <PageHeader
          title="Menu"
          subtitle={
            <span className="flex items-center gap-1.5">
              <Calendar size={14} className="text-primary-500 dark:text-primary-400" />
              {isToday(effectiveDate) ? "Today's Menu" : `Menu for ${format(effectiveDate, 'EEE, MMM d')}`}
            </span>
          }
          action={
            <button
              onClick={() => setCartOpen(true)}
              className="relative p-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              <ShoppingCart size={24} />
              {summary.totalItems > 0 && (
                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center">
                  {summary.totalItems}
                </span>
              )}
              {summary.dateCount > 1 && (
                <span className="absolute -bottom-1 -right-1 bg-amber-500 text-white text-[10px] rounded-full px-1">
                  {summary.dateCount}d
                </span>
              )}
            </button>
          }
        />

        {/* Date Selector for Advance Ordering */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1">
              <Calendar size={16} className="text-primary-500 dark:text-primary-400" />
              Order for:
            </span>
            {!isToday(effectiveDate) && (
              <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full">
                Advance Order
              </span>
            )}
          </div>
          {weekdaysInfo && (
            <div className="flex gap-1 overflow-x-auto pb-1">
              {weekdaysInfo.map((dayInfo) => {
                const isSelected = dayInfo.dateStr === formatDateLocal(effectiveDate);
                const isTodayDate = isToday(dayInfo.date);
                
                return (
                  <button
                    key={dayInfo.dateStr}
                    onClick={() => setSelectedDate(dayInfo.date)}
                    className={`flex-1 min-w-[60px] px-2 py-2 rounded-lg text-xs font-medium transition-colors relative ${
                      dayInfo.isHoliday
                        ? isSelected
                          ? 'bg-red-600 text-white'
                          : 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-2 border-red-200 dark:border-red-800'
                        : dayInfo.isMakeupDay
                        ? isSelected
                          ? 'bg-emerald-600 text-white'
                          : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-2 border-emerald-200 dark:border-emerald-800'
                        : isSelected
                        ? 'bg-primary-600 text-white'
                        : isTodayDate
                        ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 border-2 border-primary-200 dark:border-primary-800'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1">
                      {dayInfo.isHoliday && <CalendarOff size={10} />}
                      {dayInfo.isMakeupDay && <CalendarDays size={10} />}
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

        <StudentSelector
          students={students || []}
          selectedChildId={selectedStudentId}
          onSelect={setSelectedStudentId}
        />

        {/* Weekly Cart Summary - shows multi-day cart at a glance */}
        <WeeklyCartSummary
          items={items}
          daysToShow={5}
          onDateClick={(dateStr) => {
            // Navigate to that date
            const targetDay = weekdaysInfo?.find(d => d.dateStr === dateStr);
            if (targetDay) {
              setSelectedDate(targetDay.date);
            }
          }}
          onViewCart={() => setCartOpen(true)}
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
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
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
            <div className="w-20 h-20 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
              <Calendar size={40} className="text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">No Menu Available</h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
              The menu for {format(effectiveDate, 'EEEE, MMMM d')} hasn't been set yet. 
              Please check back later or try another day.
            </p>
            {weekdaysInfo && weekdaysInfo.length > 1 && (
              <div className="mt-4">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Try ordering for:</p>
                <div className="flex gap-2 justify-center flex-wrap">
                  {weekdaysInfo
                    .filter(w => w.dateStr !== formatDateLocal(effectiveDate) && w.isOpen)
                    .slice(0, 3)
                    .map(dayInfo => (
                      <button
                        key={dayInfo.dateStr}
                        onClick={() => setSelectedDate(dayInfo.date)}
                        className="px-3 py-1.5 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 rounded-lg text-sm font-medium hover:bg-primary-100 dark:hover:bg-primary-900/50"
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
            <p className="text-gray-500 dark:text-gray-400 text-lg">
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

      {/* Snack Meal Period Popup */}
      {snackPopup && (
        <>
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-50"
            onClick={() => setSnackPopup(null)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-xs w-full p-6 space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 text-center">
                When should this snack be served?
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
                {products?.find(p => p.id === snackPopup.productId)?.name}
              </p>
              <div className="space-y-2">
                <button
                  onClick={() => handleSnackMealSelect('morning_snack')}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
                >
                  <span className="text-2xl">{MEAL_PERIOD_ICONS.morning_snack}</span>
                  <div className="text-left">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{MEAL_PERIOD_LABELS.morning_snack}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Before lunch break</div>
                  </div>
                </button>
                <button
                  onClick={() => handleSnackMealSelect('afternoon_snack')}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-orange-200 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/30 hover:bg-orange-100 dark:hover:bg-orange-900/50 transition-colors"
                >
                  <span className="text-2xl">{MEAL_PERIOD_ICONS.afternoon_snack}</span>
                  <div className="text-left">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{MEAL_PERIOD_LABELS.afternoon_snack}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">After lunch break</div>
                  </div>
                </button>
              </div>
              <button
                onClick={() => setSnackPopup(null)}
                className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 py-2"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      <CartDrawer
        isOpen={cartOpen}
        onClose={() => setCartOpen(false)}
        items={items}
        itemsByStudent={itemsByStudent}
        itemsByDateAndStudent={itemsByDateAndStudent}
        onUpdateQuantity={updateQuantity}
        onCheckout={handleCheckout}
        onClearDate={clearDate}
        onCopyDateItems={copyDateItems}
        parentBalance={parentBalance}
      />
    </div>
  );
}