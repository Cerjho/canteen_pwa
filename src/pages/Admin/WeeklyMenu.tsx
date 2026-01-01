import { useState } from 'react';
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
  CalendarDays
} from 'lucide-react';
import { format, addWeeks, subWeeks, startOfWeek, endOfWeek, addDays, isSameWeek } from 'date-fns';
import { supabase } from '../../services/supabaseClient';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import type { Product, ProductCategory } from '../../types';

interface MenuSchedule {
  id: string;
  product_id: string;
  day_of_week: number;
  is_active: boolean;
  product?: Product;
}

interface Holiday {
  id: string;
  name: string;
  date: string;
  description?: string;
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

// Get the week's date range label
function getWeekLabel(date: Date): string {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 }); // Monday
  const weekEnd = endOfWeek(date, { weekStartsOn: 1 }); // Sunday
  const monthStart = format(weekStart, 'MMM d');
  const monthEnd = format(weekEnd, 'd, yyyy');
  return `${monthStart} - ${monthEnd}`;
}

// Check if a date is in the current week
function isCurrentWeek(date: Date): boolean {
  return isSameWeek(date, new Date(), { weekStartsOn: 1 });
}

export default function AdminWeeklyMenu() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  
  // Week navigation state
  const [selectedWeek, setSelectedWeek] = useState(() => new Date());
  
  const [selectedDay, setSelectedDay] = useState(() => {
    const today = new Date().getDay();
    // If weekend, default to Monday
    return today === 0 || today === 6 ? 1 : today;
  });
  const [showAddModal, setShowAddModal] = useState(false);
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<ProductCategory | 'all'>('all');
  const [activeTab, setActiveTab] = useState<'menu' | 'holidays'>('menu');
  
  // Week navigation handlers
  const goToPrevWeek = () => setSelectedWeek(prev => subWeeks(prev, 1));
  const goToNextWeek = () => setSelectedWeek(prev => addWeeks(prev, 1));
  const goToCurrentWeek = () => setSelectedWeek(new Date());
  
  // Get the actual date for the selected day in the selected week
  const getDateForDay = (dayOfWeek: number): Date => {
    const weekStart = startOfWeek(selectedWeek, { weekStartsOn: 1 });
    return addDays(weekStart, dayOfWeek - 1); // dayOfWeek 1 = Monday = 0 days after week start
  };

  // Fetch all products
  const { data: products } = useQuery<Product[]>({
    queryKey: ['all-products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('category', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return data;
    }
  });

  // Fetch menu schedules for all days (with product details)
  const { data: schedules, isLoading } = useQuery<MenuSchedule[]>({
    queryKey: ['menu-schedules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('menu_schedules')
        .select(`
          *,
          product:products(*)
        `)
        .order('day_of_week');
      if (error) throw error;
      return data;
    }
  });

  // Fetch holidays
  const { data: holidays } = useQuery<Holiday[]>({
    queryKey: ['holidays'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('holidays')
        .select('*')
        .gte('date', new Date().toISOString().split('T')[0])
        .order('date', { ascending: true });
      if (error) throw error;
      return data;
    }
  });

  // Add product to day schedule
  const addToSchedule = useMutation({
    mutationFn: async ({ productId, dayOfWeek }: { productId: string; dayOfWeek: number }) => {
      const { error } = await supabase
        .from('menu_schedules')
        .upsert({
          product_id: productId,
          day_of_week: dayOfWeek,
          is_active: true
        }, {
          onConflict: 'product_id,day_of_week'
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-schedules'] });
      showToast('Product added to menu', 'success');
    },
    onError: () => showToast('Failed to add product', 'error')
  });

  // Remove product from day schedule
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

  // Copy menu to another day
  const copyToDay = useMutation({
    mutationFn: async ({ fromDay, toDay }: { fromDay: number; toDay: number }) => {
      const daySchedules = schedules?.filter(s => s.day_of_week === fromDay) || [];
      
      if (daySchedules.length === 0) {
        throw new Error('No items to copy');
      }

      // Delete existing schedules for target day
      await supabase
        .from('menu_schedules')
        .delete()
        .eq('day_of_week', toDay);

      // Insert copies
      const { error } = await supabase
        .from('menu_schedules')
        .insert(
          daySchedules.map(s => ({
            product_id: s.product_id,
            day_of_week: toDay,
            is_active: true
          }))
        );
      if (error) throw error;
    },
    onSuccess: (_, { toDay }) => {
      queryClient.invalidateQueries({ queryKey: ['menu-schedules'] });
      showToast(`Menu copied to ${WEEKDAYS.find(d => d.value === toDay)?.label}`, 'success');
    },
    onError: () => showToast('Failed to copy menu', 'error')
  });

  // Add holiday
  const addHoliday = useMutation({
    mutationFn: async (holiday: { name: string; date: string; description?: string }) => {
      const { error } = await supabase
        .from('holidays')
        .insert(holiday);
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
      const { error } = await supabase
        .from('holidays')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
      showToast('Holiday removed', 'success');
    },
    onError: () => showToast('Failed to remove holiday', 'error')
  });

  // Get schedules for selected day
  const daySchedules = schedules?.filter(s => s.day_of_week === selectedDay) || [];

  // Get products not in current day's schedule
  const availableProducts = products?.filter(
    p => !daySchedules.some(s => s.product_id === p.id)
  );

  // Filter available products by category
  const filteredAvailableProducts = selectedCategory === 'all' 
    ? availableProducts 
    : availableProducts?.filter(p => p.category === selectedCategory);

  // Group day schedules by category
  const groupedSchedules = daySchedules.reduce((acc, schedule) => {
    const category = schedule.product?.category || 'other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(schedule);
    return acc;
  }, {} as Record<string, MenuSchedule[]>);

  const handlePrevDay = () => {
    const currentIndex = WEEKDAYS.findIndex(d => d.value === selectedDay);
    const prevIndex = currentIndex === 0 ? WEEKDAYS.length - 1 : currentIndex - 1;
    setSelectedDay(WEEKDAYS[prevIndex].value);
  };

  const handleNextDay = () => {
    const currentIndex = WEEKDAYS.findIndex(d => d.value === selectedDay);
    const nextIndex = currentIndex === WEEKDAYS.length - 1 ? 0 : currentIndex + 1;
    setSelectedDay(WEEKDAYS[nextIndex].value);
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
                <button
                  onClick={goToPrevWeek}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <ChevronLeft size={20} />
                </button>
                <div className="text-center flex-1">
                  <div className="flex items-center justify-center gap-2">
                    <CalendarDays size={18} className="text-primary-500" />
                    <span className="font-semibold text-gray-900">
                      {getWeekLabel(selectedWeek)}
                    </span>
                    {isCurrentWeek(selectedWeek) && (
                      <span className="px-2 py-0.5 bg-primary-100 text-primary-700 text-xs rounded-full">
                        This Week
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={goToNextWeek}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
              {!isCurrentWeek(selectedWeek) && (
                <button
                  onClick={goToCurrentWeek}
                  className="w-full text-sm text-primary-600 hover:underline"
                >
                  Go to current week
                </button>
              )}
            </div>
            {/* Day Selector */}
            <div className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={handlePrevDay}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <ChevronLeft size={20} />
                </button>
                <div className="text-center">
                  <h2 className="text-xl font-bold text-gray-900">
                    {WEEKDAYS.find(d => d.value === selectedDay)?.label}
                  </h2>
                  <p className="text-sm text-gray-500">
                    {format(getDateForDay(selectedDay), 'MMM d')} • {daySchedules.length} items
                  </p>
                </div>
                <button
                  onClick={handleNextDay}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <ChevronRight size={20} />
                </button>
              </div>

              {/* Day Pills - Weekdays only with dates */}
              <div className="flex gap-1 overflow-x-auto pb-2">
                {WEEKDAYS.map(day => {
                  const count = schedules?.filter(s => s.day_of_week === day.value).length || 0;
                  const dayDate = getDateForDay(day.value);
                  const today = new Date();
                  const isToday = isCurrentWeek(selectedWeek) && today.getDay() === day.value;
                  return (
                    <button
                      key={day.value}
                      onClick={() => setSelectedDay(day.value)}
                      className={`flex-1 px-2 py-2 rounded-lg text-xs font-medium transition-colors relative flex flex-col items-center ${
                        selectedDay === day.value
                          ? 'bg-primary-600 text-white'
                          : isToday
                          ? 'bg-primary-50 text-primary-700 border-2 border-primary-200'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      <span>{day.short}</span>
                      <span className={`text-[10px] ${
                        selectedDay === day.value ? 'text-primary-200' : 'text-gray-400'
                      }`}>
                        {format(dayDate, 'd')}
                      </span>
                      {count > 0 && (
                        <span className={`absolute -top-1 -right-1 w-4 h-4 rounded-full text-[10px] flex items-center justify-center ${
                          selectedDay === day.value ? 'bg-white text-primary-600' : 'bg-primary-100 text-primary-600'
                        }`}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex gap-2">
              <button
                onClick={() => setShowAddModal(true)}
                className="flex-1 flex items-center justify-center gap-2 bg-primary-600 text-white py-3 rounded-xl font-medium hover:bg-primary-700 transition-colors"
              >
                <Plus size={20} />
                Add Items
              </button>
              
              {daySchedules.length > 0 && (
                <div className="relative group">
                  <button
                    className="px-4 py-3 bg-white border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Copy To...
                  </button>
                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg py-2 hidden group-hover:block z-10 min-w-[140px]">
                    {WEEKDAYS.filter(d => d.value !== selectedDay).map(day => (
                      <button
                        key={day.value}
                        onClick={() => copyToDay.mutate({ fromDay: selectedDay, toDay: day.value })}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
                      >
                        {day.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Menu Items for Selected Day */}
            {daySchedules.length === 0 ? (
              <div className="bg-white rounded-xl p-8 text-center">
                <Calendar size={48} className="mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500 mb-4">No menu items for {WEEKDAYS.find(d => d.value === selectedDay)?.label}</p>
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

                  return (
                    <div key={category} className="bg-white rounded-xl shadow-sm overflow-hidden">
                      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                        <span className="text-gray-500">{CATEGORY_ICONS[category]}</span>
                        <h3 className="font-semibold text-gray-900 capitalize">{category}</h3>
                        <span className="text-sm text-gray-400">({items.length})</span>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {items.map(schedule => (
                          <div
                            key={schedule.id}
                            className="flex items-center gap-3 p-3"
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
                              <p className="font-medium text-gray-900 truncate">
                                {schedule.product?.name}
                              </p>
                              <p className="text-sm text-primary-600">
                                ₱{schedule.product?.price.toFixed(2)}
                              </p>
                            </div>
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
        )}

        {activeTab === 'holidays' && (
          <>
            {/* Add Holiday Button */}
            <button
              onClick={() => setShowHolidayModal(true)}
              className="w-full flex items-center justify-center gap-2 bg-primary-600 text-white py-3 rounded-xl font-medium hover:bg-primary-700 transition-colors"
            >
              <Plus size={20} />
              Add Holiday
            </button>

            {/* Info Box */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex gap-3">
                <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800">
                  <p className="font-medium mb-1">Holidays will close the canteen</p>
                  <p>On holidays, the menu will not be available for ordering. Parents will see a "Canteen Closed" message.</p>
                </div>
              </div>
            </div>

            {/* Holidays List */}
            {!holidays || holidays.length === 0 ? (
              <div className="bg-white rounded-xl p-8 text-center">
                <CalendarOff size={48} className="mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500 mb-4">No upcoming holidays</p>
                <button
                  onClick={() => setShowHolidayModal(true)}
                  className="text-primary-600 hover:underline"
                >
                  Add first holiday
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {holidays.map(holiday => (
                  <div
                    key={holiday.id}
                    className="bg-white rounded-xl p-4 shadow-sm border border-gray-100"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                          <CalendarOff size={24} className="text-red-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900">{holiday.name}</h3>
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
          <div 
            className="fixed inset-0 bg-black/50 z-50" 
            onClick={() => setShowAddModal(false)} 
          />
          <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold">
                  Add to {WEEKDAYS.find(d => d.value === selectedDay)?.label}
                </h3>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <X size={20} />
                </button>
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
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {filteredAvailableProducts?.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  {availableProducts?.length === 0
                    ? 'All products have been added'
                    : 'No products in this category'}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {filteredAvailableProducts?.map(product => (
                    <button
                      key={product.id}
                      onClick={() => {
                        addToSchedule.mutate({ 
                          productId: product.id, 
                          dayOfWeek: selectedDay 
                        });
                      }}
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
                      <p className="font-medium text-gray-900 text-sm truncate">
                        {product.name}
                      </p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-primary-600">
                          ₱{product.price.toFixed(2)}
                        </span>
                        <span className="text-xs text-gray-400 capitalize">
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

      {/* Add Holiday Modal */}
      {showHolidayModal && (
        <HolidayModal
          onClose={() => setShowHolidayModal(false)}
          onSubmit={(data) => addHoliday.mutate(data)}
          isLoading={addHoliday.isPending}
        />
      )}
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
  onSubmit: (data: { name: string; date: string; description?: string }) => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !date) return;
    onSubmit({ name: name.trim(), date, description: description.trim() || undefined });
  };

  // Common Philippine holidays for quick add
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
    // If the date has passed this year, use next year
    if (holidayDate < new Date()) {
      holidayDate.setFullYear(year + 1);
    }
    setName(holiday.name);
    setDate(holidayDate.toISOString().split('T')[0]);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
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
                {quickHolidays.slice(0, 6).map(holiday => (
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
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
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
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
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
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
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
