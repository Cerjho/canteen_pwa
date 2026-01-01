import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Calendar, 
  Plus, 
  Trash2, 
  ChevronLeft, 
  ChevronRight,
  X,
  Coffee,
  UtensilsCrossed,
  Cookie,
  Package,
  CalendarOff,
  AlertTriangle,
  CalendarDays,
  Copy,
  Grid3X3,
  List,
  Search,
  Eye,
  EyeOff,
  Layers,
  Trash,
  RefreshCw
} from 'lucide-react';
import { format, addWeeks, subWeeks, startOfWeek, endOfWeek, addDays, isSameWeek, isToday } from 'date-fns';
import { supabase } from '../../services/supabaseClient';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { Product, ProductCategory } from '../../types';

// Helper to format date in local timezone (avoids UTC shift issues)
function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface MenuSchedule {
  id: string;
  product_id: string;
  day_of_week: number;
  scheduled_date?: string; // New: specific date for this schedule
  is_active: boolean;
  product?: Product;
}

interface Holiday {
  id: string;
  name: string;
  date: string;
  description?: string;
  is_recurring?: boolean;
}

// Weekdays only (Monday = 1 through Friday = 5)
const WEEKDAYS = [
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
];

const CATEGORY_ICONS: Record<ProductCategory, React.ReactNode> = {
  mains: <UtensilsCrossed size={16} />,
  snacks: <Cookie size={16} />,
  drinks: <Coffee size={16} />,
};

const CATEGORY_COLORS: Record<ProductCategory, string> = {
  mains: 'bg-orange-100 text-orange-700',
  snacks: 'bg-purple-100 text-purple-700',
  drinks: 'bg-blue-100 text-blue-700',
};

// Get the week's date range label
function getWeekLabel(date: Date): string {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(date, { weekStartsOn: 1 });
  const monthStart = format(weekStart, 'MMM d');
  const monthEnd = format(weekEnd, 'd, yyyy');
  return `${monthStart} - ${monthEnd}`;
}

function isCurrentWeek(date: Date): boolean {
  return isSameWeek(date, new Date(), { weekStartsOn: 1 });
}

type ViewMode = 'day' | 'week';
type TabType = 'menu' | 'holidays';

export default function AdminWeeklyMenu() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  
  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [activeTab, setActiveTab] = useState<TabType>('menu');
  const [selectedWeek, setSelectedWeek] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => {
    const today = new Date().getDay();
    return today === 0 || today === 6 ? 1 : today;
  });
  
  // Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearTarget, setClearTarget] = useState<'day' | 'week'>('day');
  
  // Filter state
  const [selectedCategory, setSelectedCategory] = useState<ProductCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Week navigation
  const goToPrevWeek = () => setSelectedWeek(prev => subWeeks(prev, 1));
  const goToNextWeek = () => setSelectedWeek(prev => addWeeks(prev, 1));
  const goToCurrentWeek = () => setSelectedWeek(new Date());
  
  const getDateForDay = (dayOfWeek: number): Date => {
    const weekStart = startOfWeek(selectedWeek, { weekStartsOn: 1 });
    return addDays(weekStart, dayOfWeek - 1);
  };

  // Fetch all products (admin sees all products regardless of availability)
  const { data: products } = useQuery<Product[]>({
    queryKey: ['all-products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('category')
        .order('name');
      if (error) throw error;
      return data;
    }
  });

  // Get week date range for queries
  const weekStart = startOfWeek(selectedWeek, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(selectedWeek, { weekStartsOn: 1 });
  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const weekEndStr = format(weekEnd, 'yyyy-MM-dd');

  // Check if a specific date is a holiday
  const isHoliday = (date: Date): Holiday | undefined => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const monthDay = dateStr.slice(5); // MM-DD
    return holidays?.find(h => {
      if (h.is_recurring) {
        return h.date.slice(5) === monthDay;
      }
      return h.date === dateStr;
    });
  };

  // Fetch menu schedules for the selected week
  const { data: schedules, isLoading } = useQuery<MenuSchedule[]>({
    queryKey: ['menu-schedules', weekStartStr, weekEndStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('menu_schedules')
        .select(`*, product:products(*)`)
        .gte('scheduled_date', weekStartStr)
        .lte('scheduled_date', weekEndStr)
        .order('scheduled_date');
      if (error) throw error;
      return data;
    }
  });

  // Fetch holidays
  const { data: holidays, isLoading: holidaysLoading } = useQuery<Holiday[]>({
    queryKey: ['holidays'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('holidays')
        .select('*')
        .gte('date', formatDateLocal(new Date()))
        .order('date');
      if (error) throw error;
      return data;
    }
  });

  // Add product to schedule for a specific date
  const addToSchedule = useMutation({
    mutationFn: async ({ productId, dayOfWeek }: { productId: string; dayOfWeek: number }) => {
      const scheduledDate = format(getDateForDay(dayOfWeek), 'yyyy-MM-dd');
      const { error } = await supabase
        .from('menu_schedules')
        .upsert({
          product_id: productId,
          day_of_week: dayOfWeek,
          scheduled_date: scheduledDate,
          is_active: true
        }, { onConflict: 'product_id,scheduled_date' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-schedules'] });
      showToast('Product added to menu', 'success');
    },
    onError: () => showToast('Failed to add product', 'error')
  });

  // Add multiple products at once for a specific date
  const addBulkToSchedule = useMutation({
    mutationFn: async ({ productIds, dayOfWeek }: { productIds: string[]; dayOfWeek: number }) => {
      const scheduledDate = format(getDateForDay(dayOfWeek), 'yyyy-MM-dd');
      const items = productIds.map(id => ({
        product_id: id,
        day_of_week: dayOfWeek,
        scheduled_date: scheduledDate,
        is_active: true
      }));
      
      const { error } = await supabase
        .from('menu_schedules')
        .upsert(items, { onConflict: 'product_id,scheduled_date' });
      if (error) throw error;
    },
    onSuccess: (_, { productIds }) => {
      queryClient.invalidateQueries({ queryKey: ['menu-schedules'] });
      showToast(`Added ${productIds.length} items to menu`, 'success');
    },
    onError: () => showToast('Failed to add products', 'error')
  });

  // Remove from schedule
  const removeFromSchedule = useMutation({
    mutationFn: async (scheduleId: string) => {
      const { error } = await supabase
        .from('menu_schedules')
        .delete()
        .eq('id', scheduleId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-schedules'] });
      showToast('Product removed from menu', 'success');
    },
    onError: () => showToast('Failed to remove product', 'error')
  });

  // Toggle item active status
  const toggleItemActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('menu_schedules')
        .update({ is_active: isActive })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, { isActive }) => {
      queryClient.invalidateQueries({ queryKey: ['menu-schedules'] });
      showToast(isActive ? 'Item activated' : 'Item deactivated', 'success');
    },
    onError: () => showToast('Failed to update item', 'error')
  });

  // Copy menu to another day (same week, date-based)
  const copyToDay = useMutation({
    mutationFn: async ({ fromDay, toDay }: { fromDay: number; toDay: number }) => {
      const fromDate = format(getDateForDay(fromDay), 'yyyy-MM-dd');
      const toDate = format(getDateForDay(toDay), 'yyyy-MM-dd');
      const daySchedules = schedules?.filter(s => s.scheduled_date === fromDate) || [];
      if (daySchedules.length === 0) throw new Error('No items to copy');

      await supabase.from('menu_schedules').delete().eq('scheduled_date', toDate);

      const { error } = await supabase
        .from('menu_schedules')
        .insert(daySchedules.map(s => ({
          product_id: s.product_id,
          day_of_week: toDay,
          scheduled_date: toDate,
          is_active: s.is_active
        })));
      if (error) throw error;
    },
    onSuccess: (_, { toDay }) => {
      queryClient.invalidateQueries({ queryKey: ['menu-schedules'] });
      showToast(`Menu copied to ${WEEKDAYS.find(d => d.value === toDay)?.label}`, 'success');
    },
    onError: () => showToast('Failed to copy menu', 'error')
  });

  // Copy day to all weekdays (same week, date-based)
  const copyToAllDays = useMutation({
    mutationFn: async (fromDay: number) => {
      const fromDate = format(getDateForDay(fromDay), 'yyyy-MM-dd');
      const daySchedules = schedules?.filter(s => s.scheduled_date === fromDate) || [];
      if (daySchedules.length === 0) throw new Error('No items to copy');

      const targetDays = WEEKDAYS.filter(d => d.value !== fromDay).map(d => d.value);
      
      // Delete and insert for each target day
      const allItems: Array<{ product_id: string; day_of_week: number; scheduled_date: string; is_active: boolean }> = [];
      for (const toDay of targetDays) {
        const toDate = format(getDateForDay(toDay), 'yyyy-MM-dd');
        await supabase.from('menu_schedules').delete().eq('scheduled_date', toDate);
        
        daySchedules.forEach(s => {
          allItems.push({
            product_id: s.product_id,
            day_of_week: toDay,
            scheduled_date: toDate,
            is_active: s.is_active
          });
        });
      }

      const { error } = await supabase.from('menu_schedules').insert(allItems);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-schedules'] });
      showToast('Menu copied to all weekdays', 'success');
    },
    onError: () => showToast('Failed to copy menu', 'error')
  });

  // Clear day's menu (for specific date)
  const clearDayMenu = useMutation({
    mutationFn: async (dayOfWeek: number) => {
      const scheduledDate = format(getDateForDay(dayOfWeek), 'yyyy-MM-dd');
      const { error } = await supabase
        .from('menu_schedules')
        .delete()
        .eq('scheduled_date', scheduledDate);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-schedules'] });
      setShowClearConfirm(false);
      showToast('Day menu cleared', 'success');
    },
    onError: () => showToast('Failed to clear menu', 'error')
  });

  // Clear entire week (for selected week's dates)
  const clearWeekMenu = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('menu_schedules')
        .delete()
        .gte('scheduled_date', weekStartStr)
        .lte('scheduled_date', weekEndStr);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-schedules'] });
      setShowClearConfirm(false);
      showToast('Week menu cleared', 'success');
    },
    onError: () => showToast('Failed to clear menu', 'error')
  });

  // Add holiday
  const addHoliday = useMutation({
    mutationFn: async (holiday: { name: string; date: string; description?: string; is_recurring?: boolean }) => {
      const { error } = await supabase.from('holidays').insert(holiday);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
      setShowHolidayModal(false);
      showToast('Holiday added', 'success');
    },
    onError: (error: any) => {
      if (error.code === '23505') {
        showToast('Holiday already exists for this date', 'error');
      } else {
        showToast('Failed to add holiday', 'error');
      }
    }
  });

  // Remove holiday
  const removeHoliday = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('holidays').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
      showToast('Holiday removed', 'success');
    },
    onError: () => showToast('Failed to remove holiday', 'error')
  });

  // Computed values - filter by specific date
  const selectedDateStr = format(getDateForDay(selectedDay), 'yyyy-MM-dd');
  const daySchedules = schedules?.filter(s => s.scheduled_date === selectedDateStr) || [];
  const activeItemsCount = daySchedules.filter(s => s.is_active).length;
  
  // Check if selected day is a holiday
  const selectedDayHoliday = isHoliday(getDateForDay(selectedDay));
  
  const availableProducts = products?.filter(
    p => !daySchedules.some(s => s.product_id === p.id)
  );

  const filteredAvailableProducts = useMemo(() => {
    let filtered = availableProducts || [];
    
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(p => p.category === selectedCategory);
    }
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(query) ||
        p.description?.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }, [availableProducts, selectedCategory, searchQuery]);

  const groupedSchedules = daySchedules.reduce((acc, schedule) => {
    const category = schedule.product?.category || 'other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(schedule);
    return acc;
  }, {} as Record<string, MenuSchedule[]>);

  // Statistics - use date-based filtering
  const weekStats = useMemo(() => {
    const stats = WEEKDAYS.map(day => {
      const dayDateStr = format(getDateForDay(day.value), 'yyyy-MM-dd');
      const dayItems = schedules?.filter(s => s.scheduled_date === dayDateStr) || [];
      const activeItems = dayItems.filter(s => s.is_active);
      const dayHoliday = isHoliday(getDateForDay(day.value));
      return {
        day: day.value,
        date: dayDateStr,
        total: dayItems.length,
        active: activeItems.length,
        mains: dayItems.filter(s => s.product?.category === 'mains').length,
        snacks: dayItems.filter(s => s.product?.category === 'snacks').length,
        drinks: dayItems.filter(s => s.product?.category === 'drinks').length,
        isHoliday: !!dayHoliday,
        holidayName: dayHoliday?.name,
      };
    });
    return stats;
  }, [schedules, selectedWeek, holidays]);

  const handlePrevDay = () => {
    const idx = WEEKDAYS.findIndex(d => d.value === selectedDay);
    setSelectedDay(WEEKDAYS[idx === 0 ? WEEKDAYS.length - 1 : idx - 1].value);
  };

  const handleNextDay = () => {
    const idx = WEEKDAYS.findIndex(d => d.value === selectedDay);
    setSelectedDay(WEEKDAYS[idx === WEEKDAYS.length - 1 ? 0 : idx + 1].value);
  };

  const handleAddAll = (category: ProductCategory | 'all') => {
    const toAdd = category === 'all' 
      ? availableProducts?.map(p => p.id) || []
      : availableProducts?.filter(p => p.category === category).map(p => p.id) || [];
    
    if (toAdd.length === 0) {
      showToast('No items to add', 'info');
      return;
    }
    
    addBulkToSchedule.mutate({ productIds: toAdd, dayOfWeek: selectedDay });
  };

  const handleClearConfirm = () => {
    if (clearTarget === 'day') {
      clearDayMenu.mutate(selectedDay);
    } else {
      clearWeekMenu.mutate();
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <PageHeader title="Weekly Menu" />

      <div className="px-4 space-y-4">
        {/* Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('menu')}
            className={`flex-1 py-2.5 rounded-xl font-medium transition-colors ${
              activeTab === 'menu'
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-600 border border-gray-200'
            }`}
          >
            <Calendar size={18} className="inline mr-2" />
            Menu Schedule
          </button>
          <button
            onClick={() => setActiveTab('holidays')}
            className={`flex-1 py-2.5 rounded-xl font-medium transition-colors ${
              activeTab === 'holidays'
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-600 border border-gray-200'
            }`}
          >
            <CalendarOff size={18} className="inline mr-2" />
            Holidays
            {holidays && holidays.length > 0 && (
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${
                activeTab === 'holidays' ? 'bg-primary-500' : 'bg-gray-100'
              }`}>
                {holidays.length}
              </span>
            )}
          </button>
        </div>

        {activeTab === 'menu' && (
          <>
            {/* Week Navigator */}
            <div className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <button onClick={goToPrevWeek} className="p-2 hover:bg-gray-100 rounded-lg">
                  <ChevronLeft size={20} />
                </button>
                <div className="text-center flex-1">
                  <div className="flex items-center justify-center gap-2">
                    <CalendarDays size={18} className="text-primary-500" />
                    <span className="font-semibold text-gray-900">{getWeekLabel(selectedWeek)}</span>
                    {isCurrentWeek(selectedWeek) && (
                      <span className="px-2 py-0.5 bg-primary-100 text-primary-700 text-xs rounded-full">
                        This Week
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={goToNextWeek} className="p-2 hover:bg-gray-100 rounded-lg">
                  <ChevronRight size={20} />
                </button>
              </div>
              
              <div className="flex items-center justify-center gap-2">
                {!isCurrentWeek(selectedWeek) && (
                  <button onClick={goToCurrentWeek} className="text-sm text-primary-600 hover:underline">
                    Go to current week
                  </button>
                )}
                
                {/* View Toggle */}
                <div className="flex bg-gray-100 rounded-lg p-1 ml-auto">
                  <button
                    onClick={() => setViewMode('day')}
                    className={`p-1.5 rounded ${viewMode === 'day' ? 'bg-white shadow-sm' : ''}`}
                    title="Day view"
                  >
                    <List size={16} />
                  </button>
                  <button
                    onClick={() => setViewMode('week')}
                    className={`p-1.5 rounded ${viewMode === 'week' ? 'bg-white shadow-sm' : ''}`}
                    title="Week view"
                  >
                    <Grid3X3 size={16} />
                  </button>
                </div>
              </div>
            </div>

            {viewMode === 'day' ? (
              <>
                {/* Day Selector */}
                <div className="bg-white rounded-xl shadow-sm p-4">
                  <div className="flex items-center justify-between mb-4">
                    <button onClick={handlePrevDay} className="p-2 hover:bg-gray-100 rounded-lg">
                      <ChevronLeft size={20} />
                    </button>
                    <div className="text-center">
                      <h2 className="text-xl font-bold text-gray-900">
                        {WEEKDAYS.find(d => d.value === selectedDay)?.label}
                      </h2>
                      <p className="text-sm text-gray-500">
                        {format(getDateForDay(selectedDay), 'MMM d')} • {activeItemsCount}/{daySchedules.length} active
                      </p>
                    </div>
                    <button onClick={handleNextDay} className="p-2 hover:bg-gray-100 rounded-lg">
                      <ChevronRight size={20} />
                    </button>
                  </div>

                  {/* Day Pills */}
                  <div className="flex gap-1 overflow-x-auto pb-2">
                    {WEEKDAYS.map(day => {
                      const stat = weekStats.find(s => s.day === day.value);
                      const dayDate = getDateForDay(day.value);
                      const isTodayDate = isCurrentWeek(selectedWeek) && isToday(dayDate);
                      const dayIsHoliday = stat?.isHoliday;
                      
                      return (
                        <button
                          key={day.value}
                          onClick={() => setSelectedDay(day.value)}
                          className={`flex-1 px-2 py-2 rounded-lg text-xs font-medium transition-colors relative flex flex-col items-center ${
                            dayIsHoliday
                              ? selectedDay === day.value
                                ? 'bg-red-600 text-white'
                                : 'bg-red-50 text-red-600 border-2 border-red-200'
                              : selectedDay === day.value
                              ? 'bg-primary-600 text-white'
                              : isTodayDate
                              ? 'bg-primary-50 text-primary-700 border-2 border-primary-200'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          <span>{day.short}</span>
                          <span className={`text-[10px] ${
                            dayIsHoliday
                              ? selectedDay === day.value ? 'text-red-200' : 'text-red-400'
                              : selectedDay === day.value ? 'text-primary-200' : 'text-gray-400'
                          }`}>
                            {format(dayDate, 'd')}
                          </span>
                          {dayIsHoliday ? (
                            <CalendarOff size={10} className="absolute -top-1 -right-1" />
                          ) : (stat?.total || 0) > 0 && (
                            <span className={`absolute -top-1 -right-1 w-4 h-4 rounded-full text-[10px] flex items-center justify-center ${
                              selectedDay === day.value ? 'bg-white text-primary-600' : 'bg-primary-100 text-primary-600'
                            }`}>
                              {stat?.active || 0}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Holiday Warning */}
                {selectedDayHoliday && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                    <CalendarOff className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
                    <div>
                      <p className="font-medium text-red-800">Holiday: {selectedDayHoliday.name}</p>
                      <p className="text-sm text-red-600">
                        The canteen is closed on this day. Menu items set here will not be available to parents.
                      </p>
                    </div>
                  </div>
                )}

                {/* Quick Actions */}
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => setShowAddModal(true)}
                    disabled={!!selectedDayHoliday}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium transition-colors ${
                      selectedDayHoliday
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-primary-600 text-white hover:bg-primary-700'
                    }`}
                  >
                    <Plus size={20} />
                    Add Items
                  </button>
                  
                  {daySchedules.length > 0 && (
                    <>
                      {/* Copy dropdown */}
                      <div className="relative group">
                        <button className="px-4 py-3 bg-white border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2">
                          <Copy size={18} />
                          Copy
                        </button>
                        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg py-2 hidden group-hover:block z-10 min-w-[160px]">
                          {WEEKDAYS.filter(d => d.value !== selectedDay).map(day => (
                            <button
                              key={day.value}
                              onClick={() => copyToDay.mutate({ fromDay: selectedDay, toDay: day.value })}
                              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
                            >
                              {day.label}
                            </button>
                          ))}
                          <div className="border-t border-gray-100 my-1" />
                          <button
                            onClick={() => copyToAllDays.mutate(selectedDay)}
                            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 text-primary-600 font-medium"
                          >
                            All Weekdays
                          </button>
                        </div>
                      </div>
                      
                      {/* Clear button */}
                      <button
                        onClick={() => { setClearTarget('day'); setShowClearConfirm(true); }}
                        className="px-4 py-3 bg-white border border-red-200 rounded-xl font-medium text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <Trash size={18} />
                      </button>
                    </>
                  )}
                </div>

                {/* Menu Items */}
                {daySchedules.length === 0 ? (
                  <div className="bg-white rounded-xl p-8 text-center">
                    <Calendar size={48} className="mx-auto text-gray-300 mb-3" />
                    <p className="text-gray-500 mb-4">
                      No menu items for {WEEKDAYS.find(d => d.value === selectedDay)?.label}
                    </p>
                    <button
                      onClick={() => setShowAddModal(true)}
                      className="text-primary-600 hover:underline"
                    >
                      Add items to this day
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {(['mains', 'snacks', 'drinks'] as ProductCategory[]).map(category => {
                      const items = groupedSchedules[category];
                      if (!items || items.length === 0) return null;

                      const activeCount = items.filter(i => i.is_active).length;

                      return (
                        <div key={category} className="bg-white rounded-xl shadow-sm overflow-hidden">
                          <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500">{CATEGORY_ICONS[category]}</span>
                              <h3 className="font-semibold text-gray-900 capitalize">{category}</h3>
                              <span className="text-sm text-gray-400">({activeCount}/{items.length})</span>
                            </div>
                          </div>
                          <div className="divide-y divide-gray-100">
                            {items.map(schedule => (
                              <div
                                key={schedule.id}
                                className={`flex items-center gap-3 p-3 ${!schedule.is_active ? 'opacity-50 bg-gray-50' : ''}`}
                              >
                                {schedule.product?.image_url ? (
                                  <img
                                    src={schedule.product.image_url}
                                    alt={schedule.product.name}
                                    className="w-12 h-12 rounded-lg object-cover"
                                  />
                                ) : (
                                  <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center">
                                    <Package size={20} className="text-gray-400" />
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="font-medium text-gray-900 truncate">
                                      {schedule.product?.name}
                                    </p>
                                    {!schedule.is_active && (
                                      <span className="px-1.5 py-0.5 bg-gray-200 text-gray-600 text-xs rounded">
                                        Hidden
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-sm text-primary-600">
                                    ₱{schedule.product?.price.toFixed(2)}
                                  </p>
                                </div>
                                <button
                                  onClick={() => toggleItemActive.mutate({ 
                                    id: schedule.id, 
                                    isActive: !schedule.is_active 
                                  })}
                                  className={`p-2 rounded-lg ${
                                    schedule.is_active 
                                      ? 'text-green-600 hover:bg-green-50' 
                                      : 'text-gray-400 hover:bg-gray-100'
                                  }`}
                                  title={schedule.is_active ? 'Hide item' : 'Show item'}
                                >
                                  {schedule.is_active ? <Eye size={18} /> : <EyeOff size={18} />}
                                </button>
                                <button
                                  onClick={() => removeFromSchedule.mutate(schedule.id)}
                                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                                >
                                  <Trash2 size={18} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              /* Week Overview Grid */
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b">
                  <h3 className="font-semibold">Week Overview</h3>
                  <button
                    onClick={() => { setClearTarget('week'); setShowClearConfirm(true); }}
                    className="text-sm text-red-600 hover:underline flex items-center gap-1"
                  >
                    <Trash size={14} />
                    Clear Week
                  </button>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px]">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-24">Category</th>
                        {WEEKDAYS.map(day => {
                          const dayDate = getDateForDay(day.value);
                          const isTodayDate = isCurrentWeek(selectedWeek) && isToday(dayDate);
                          return (
                            <th 
                              key={day.value} 
                              className={`px-2 py-2 text-center text-xs font-medium ${
                                isTodayDate ? 'bg-primary-50 text-primary-700' : 'text-gray-500'
                              }`}
                            >
                              <div>{day.short}</div>
                              <div className="text-[10px] font-normal">{format(dayDate, 'd')}</div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(['mains', 'snacks', 'drinks'] as ProductCategory[]).map(category => (
                        <tr key={category}>
                          <td className="px-3 py-3">
                            <div className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${CATEGORY_COLORS[category]}`}>
                              {CATEGORY_ICONS[category]}
                              <span className="capitalize">{category}</span>
                            </div>
                          </td>
                          {WEEKDAYS.map(day => {
                            const dayItems = schedules?.filter(
                              s => s.day_of_week === day.value && s.product?.category === category
                            ) || [];
                            const activeItems = dayItems.filter(s => s.is_active);
                            
                            return (
                              <td key={day.value} className="px-2 py-3 text-center">
                                {dayItems.length > 0 ? (
                                  <button
                                    onClick={() => { setSelectedDay(day.value); setViewMode('day'); }}
                                    className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary-100 text-primary-700 text-sm font-medium hover:bg-primary-200"
                                    title={`${activeItems.length} active of ${dayItems.length}`}
                                  >
                                    {activeItems.length}
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => { setSelectedDay(day.value); setViewMode('day'); setShowAddModal(true); }}
                                    className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-gray-400 text-sm hover:bg-gray-200"
                                  >
                                    <Plus size={14} />
                                  </button>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      <tr className="bg-gray-50">
                        <td className="px-3 py-2 font-medium text-xs text-gray-600">Total Active</td>
                        {weekStats.map(stat => (
                          <td key={stat.day} className="px-2 py-2 text-center font-medium text-sm">
                            {stat.active}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'holidays' && (
          <>
            <button
              onClick={() => setShowHolidayModal(true)}
              className="w-full flex items-center justify-center gap-2 bg-primary-600 text-white py-3 rounded-xl font-medium hover:bg-primary-700 transition-colors"
            >
              <Plus size={20} />
              Add Holiday
            </button>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex gap-3">
                <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800">
                  <p className="font-medium mb-1">Holidays will close the canteen</p>
                  <p>On holidays, the menu will not be available for ordering. Parents will see a "Canteen Closed" message.</p>
                </div>
              </div>
            </div>

            {holidaysLoading ? (
              <LoadingSpinner size="sm" />
            ) : !holidays || holidays.length === 0 ? (
              <div className="bg-white rounded-xl p-8 text-center">
                <CalendarOff size={48} className="mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500 mb-4">No upcoming holidays</p>
                <button onClick={() => setShowHolidayModal(true)} className="text-primary-600 hover:underline">
                  Add first holiday
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {holidays.map(holiday => (
                  <div key={holiday.id} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                          <CalendarOff size={24} className="text-red-600" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-gray-900">{holiday.name}</h3>
                            {holiday.is_recurring && (
                              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded flex items-center gap-1">
                                <RefreshCw size={10} />
                                Yearly
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-500">
                            {format(new Date(holiday.date), 'EEEE, MMMM d, yyyy')}
                          </p>
                          {holiday.description && (
                            <p className="text-sm text-gray-400 mt-1">{holiday.description}</p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => removeHoliday.mutate(holiday.id)}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Add Items Modal */}
      {showAddModal && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setShowAddModal(false)} />
          <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl max-h-[85vh] flex flex-col">
            <div className="p-4 border-b border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold">
                  Add to {WEEKDAYS.find(d => d.value === selectedDay)?.label}
                </h3>
                <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                  <X size={20} />
                </button>
              </div>

              {/* Search */}
              <div className="relative mb-3">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search products..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Category Filter */}
              <div className="flex gap-2 overflow-x-auto pb-2">
                {(['all', 'mains', 'snacks', 'drinks'] as const).map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap ${
                      selectedCategory === cat
                        ? 'bg-primary-600 text-white'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </button>
                ))}
              </div>

              {/* Bulk Add */}
              {filteredAvailableProducts && filteredAvailableProducts.length > 0 && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => handleAddAll(selectedCategory)}
                    className="flex-1 text-sm py-2 px-3 bg-primary-50 text-primary-700 rounded-lg hover:bg-primary-100 flex items-center justify-center gap-2"
                  >
                    <Layers size={16} />
                    Add All ({filteredAvailableProducts.length})
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {filteredAvailableProducts?.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  {searchQuery 
                    ? 'No products match your search'
                    : availableProducts?.length === 0
                    ? 'All products have been added'
                    : 'No products in this category'
                  }
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {filteredAvailableProducts?.map(product => (
                    <button
                      key={product.id}
                      onClick={() => addToSchedule.mutate({ productId: product.id, dayOfWeek: selectedDay })}
                      className="bg-white border border-gray-200 rounded-xl p-3 text-left hover:border-primary-300 hover:bg-primary-50 transition-colors"
                    >
                      {product.image_url ? (
                        <img
                          src={product.image_url}
                          alt={product.name}
                          className="w-full h-20 rounded-lg object-cover mb-2"
                        />
                      ) : (
                        <div className="w-full h-20 rounded-lg bg-gray-100 flex items-center justify-center mb-2">
                          <Package size={24} className="text-gray-400" />
                        </div>
                      )}
                      <p className="font-medium text-gray-900 text-sm truncate">{product.name}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-primary-600">₱{product.price.toFixed(2)}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${CATEGORY_COLORS[product.category]}`}>
                          {product.category}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Holiday Modal */}
      {showHolidayModal && (
        <HolidayModal
          onClose={() => setShowHolidayModal(false)}
          onSubmit={(data) => addHoliday.mutate(data)}
          isLoading={addHoliday.isPending}
        />
      )}

      {/* Clear Confirmation */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        title={clearTarget === 'day' ? 'Clear Day Menu' : 'Clear Week Menu'}
        message={
          clearTarget === 'day'
            ? `Remove all menu items from ${WEEKDAYS.find(d => d.value === selectedDay)?.label}?`
            : 'Remove all menu items from the entire week? This cannot be undone.'
        }
        confirmLabel="Clear"
        type="danger"
        onConfirm={handleClearConfirm}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  );
}

// Holiday Modal Component
function HolidayModal({ 
  onClose, 
  onSubmit, 
  isLoading 
}: { 
  onClose: () => void; 
  onSubmit: (data: { name: string; date: string; description?: string; is_recurring?: boolean }) => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !date) return;
    onSubmit({ 
      name: name.trim(), 
      date, 
      description: description.trim() || undefined,
      is_recurring: isRecurring || undefined
    });
  };

  // Common Philippine holidays
  const quickHolidays = [
    { name: 'New Year\'s Day', month: 1, day: 1 },
    { name: 'EDSA Revolution', month: 2, day: 25 },
    { name: 'Araw ng Kagitingan', month: 4, day: 9 },
    { name: 'Labor Day', month: 5, day: 1 },
    { name: 'Independence Day', month: 6, day: 12 },
    { name: 'Ninoy Aquino Day', month: 8, day: 21 },
    { name: 'National Heroes Day', month: 8, day: 26 },
    { name: 'All Saints\' Day', month: 11, day: 1 },
    { name: 'Bonifacio Day', month: 11, day: 30 },
    { name: 'Christmas Day', month: 12, day: 25 },
    { name: 'Rizal Day', month: 12, day: 30 },
  ];

  const setQuickHoliday = (holiday: { name: string; month: number; day: number }) => {
    const year = new Date().getFullYear();
    const holidayDate = new Date(year, holiday.month - 1, holiday.day);
    if (holidayDate < new Date()) {
      holidayDate.setFullYear(year + 1);
    }
    setName(holiday.name);
    setDate(formatDateLocal(holidayDate));
    setIsRecurring(true); // National holidays are usually recurring
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="text-lg font-bold">Add Holiday</h2>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <X size={20} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-4 space-y-4">
            {/* Quick Add */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Quick Add (Philippine Holidays)
              </label>
              <div className="flex flex-wrap gap-2">
                {quickHolidays.slice(0, 8).map(holiday => (
                  <button
                    key={holiday.name}
                    type="button"
                    onClick={() => setQuickHoliday(holiday)}
                    className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg"
                  >
                    {holiday.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Holiday Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Christmas Day"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date *
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={formatDateLocal(new Date())}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description (optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., School closed for the holidays"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            {/* Recurring Toggle */}
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div>
                <p className="font-medium text-sm">Recurring Yearly</p>
                <p className="text-xs text-gray-500">Automatically repeats every year</p>
              </div>
              <button
                type="button"
                onClick={() => setIsRecurring(!isRecurring)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  isRecurring ? 'bg-primary-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    isRecurring ? 'translate-x-5' : ''
                  }`}
                />
              </button>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || !name.trim() || !date}
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50"
              >
                {isLoading ? 'Adding...' : 'Add Holiday'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
