import { useMemo } from 'react';
import { format, addDays, isToday, isSaturday, isSunday } from 'date-fns';
import { Calendar, ShoppingCart, ChevronRight } from 'lucide-react';
import type { CartItem } from '../hooks/useCart';

interface WeeklyCartSummaryProps {
  items: CartItem[];
  daysToShow?: number;
  onDateClick?: (dateStr: string) => void;
  onViewCart?: () => void;
}

interface DaySummary {
  date: Date;
  dateStr: string;
  displayDate: string;
  dayName: string;
  isToday: boolean;
  isWeekend: boolean;
  itemCount: number;
  total: number;
  studentCount: number;
}

export function WeeklyCartSummary({ 
  items, 
  daysToShow = 5,
  onDateClick,
  onViewCart
}: WeeklyCartSummaryProps) {
  
  // Generate weekdays starting from today
  const weekDays = useMemo(() => {
    const days: DaySummary[] = [];
    const today = new Date();
    let currentDate = today;
    let daysAdded = 0;
    
    // Skip to next valid day if today is weekend
    while (isSunday(currentDate)) {
      currentDate = addDays(currentDate, 1);
    }
    
    while (daysAdded < daysToShow) {
      // Skip Sundays (Saturdays might be makeup days)
      if (!isSunday(currentDate)) {
        const dateStr = format(currentDate, 'yyyy-MM-dd');
        const dayItems = items.filter(i => i.scheduled_for === dateStr);
        const uniqueStudents = new Set(dayItems.map(i => i.student_id));
        
        days.push({
          date: currentDate,
          dateStr,
          displayDate: format(currentDate, 'd'),
          dayName: isToday(currentDate) ? 'Today' : format(currentDate, 'EEE'),
          isToday: isToday(currentDate),
          isWeekend: isSaturday(currentDate),
          itemCount: dayItems.reduce((sum, i) => sum + i.quantity, 0),
          total: dayItems.reduce((sum, i) => sum + i.price * i.quantity, 0),
          studentCount: uniqueStudents.size
        });
        daysAdded++;
      }
      currentDate = addDays(currentDate, 1);
    }
    
    return days;
  }, [items, daysToShow]);

  // Calculate totals
  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalAmount = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const uniqueDates = new Set(items.map(i => i.scheduled_for));
  const uniqueStudents = new Set(items.map(i => i.student_id));

  if (totalItems === 0) {
    return null; // Don't show if cart is empty
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-primary-600 dark:text-primary-400" />
          <span className="font-medium text-gray-900 dark:text-gray-100">Weekly Cart</span>
        </div>
        {onViewCart && (
          <button
            onClick={onViewCart}
            className="flex items-center gap-1 text-sm text-primary-600 dark:text-primary-400 hover:underline"
          >
            <ShoppingCart size={14} />
            View Cart
            <ChevronRight size={14} />
          </button>
        )}
      </div>

      {/* Day pills */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {weekDays.map((day) => (
          <button
            key={day.dateStr}
            onClick={() => onDateClick?.(day.dateStr)}
            className={`flex-shrink-0 min-w-[64px] px-3 py-2 rounded-lg text-center transition-all ${
              day.itemCount > 0
                ? day.isToday
                  ? 'bg-green-100 dark:bg-green-900/40 border-2 border-green-500'
                  : 'bg-primary-100 dark:bg-primary-900/40 border-2 border-primary-500'
                : day.isWeekend
                  ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
                  : 'bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700'
            }`}
          >
            <div className={`text-xs font-medium ${
              day.itemCount > 0
                ? day.isToday
                  ? 'text-green-700 dark:text-green-300'
                  : 'text-primary-700 dark:text-primary-300'
                : 'text-gray-500 dark:text-gray-400'
            }`}>
              {day.dayName}
            </div>
            <div className={`text-lg font-bold ${
              day.itemCount > 0
                ? day.isToday
                  ? 'text-green-700 dark:text-green-300'
                  : 'text-primary-700 dark:text-primary-300'
                : 'text-gray-400 dark:text-gray-500'
            }`}>
              {day.displayDate}
            </div>
            {day.itemCount > 0 && (
              <div className={`text-[10px] font-medium ${
                day.isToday
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-primary-600 dark:text-primary-400'
              }`}>
                {day.itemCount} item{day.itemCount !== 1 ? 's' : ''}
              </div>
            )}
            {day.itemCount > 0 && (
              <div className={`text-[10px] ${
                day.isToday
                  ? 'text-green-500 dark:text-green-500'
                  : 'text-primary-500 dark:text-primary-500'
              }`}>
                ₱{day.total.toFixed(0)}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Summary row */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
        <div className="text-sm text-gray-600 dark:text-gray-400">
          <span className="font-medium text-gray-900 dark:text-gray-100">{totalItems}</span> items
          {uniqueDates.size > 1 && (
            <> across <span className="font-medium text-gray-900 dark:text-gray-100">{uniqueDates.size}</span> days</>
          )}
          {uniqueStudents.size > 1 && (
            <> for <span className="font-medium text-gray-900 dark:text-gray-100">{uniqueStudents.size}</span> students</>
          )}
        </div>
        <div className="text-lg font-bold text-primary-600 dark:text-primary-400">
          ₱{totalAmount.toFixed(2)}
        </div>
      </div>
    </div>
  );
}
