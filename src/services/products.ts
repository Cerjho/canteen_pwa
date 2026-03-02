import { supabase } from './supabaseClient';

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  image_url: string;
  available: boolean;
  stock_quantity: number;
}

export interface MenuSchedule {
  id: string;
  product_id: string;
  day_of_week: number;
  is_active: boolean;
}

export interface CanteenStatus {
  isOpen: boolean;
  reason?: 'weekend' | 'holiday' | 'no-menu';
  holidayName?: string;
  date?: string;
  isMakeupDay?: boolean;
  makeupDayName?: string;
}

// Helper to format date as YYYY-MM-DD in Philippine timezone (UTC+8)
export function formatDateLocal(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

// Get "today" anchored to Philippine timezone (avoids browser-tz mismatch).
// Uses formatDateLocal (the canonical PH-timezone formatter) to extract the
// date components, then creates a midnight Date in local time — avoids the
// unreliable new Date(toLocaleString(...)) pattern.
function getPhilippineToday(): Date {
  const phDateStr = formatDateLocal(new Date()); // "YYYY-MM-DD" in Asia/Manila
  const [year, month, day] = phDateStr.split('-').map(Number);
  return new Date(year, month - 1, day); // midnight in local time
}

// Check if a date matches a holiday (including recurring holidays)
// Uses a single query instead of two sequential queries
async function checkHoliday(targetDate: Date): Promise<{ name: string } | null> {
  try {
    const dateStr = formatDateLocal(targetDate);
    const monthDay = dateStr.slice(5); // Extract MM-DD (e.g., "12-25" for Christmas)
    
    // Single query: fetch exact date match OR all recurring holidays
    const { data: holidays, error } = await supabase
      .from('holidays')
      .select('name, date, is_recurring')
      .or(`date.eq.${dateStr},is_recurring.eq.true`);
    
    if (error) {
      console.warn('Error checking holidays:', error.message);
      return null;
    }
    
    if (holidays) {
      // Check exact match first
      const exact = holidays.find(h => h.date === dateStr);
      if (exact) return { name: exact.name };
      
      // Check recurring holidays by month-day
      const recurring = holidays.find(h => h.is_recurring && h.date.slice(5) === monthDay);
      if (recurring) return { name: recurring.name };
    }
    
    return null;
  } catch (error) {
    console.warn('Unexpected error checking holiday:', error);
    return null;
  }
}

// Check if a Saturday is a make-up day
async function checkMakeupDay(targetDate: Date): Promise<{ name: string; reason?: string } | null> {
  const dayOfWeek = targetDate.getDay();
  
  // Only Saturdays can be make-up days
  if (dayOfWeek !== 6) return null;
  
  const dateStr = formatDateLocal(targetDate);
  
  const { data: makeupDay } = await supabase
    .from('makeup_days')
    .select('name, reason')
    .eq('date', dateStr)
    .maybeSingle();
  
  return makeupDay;
}

// Check if canteen is open on a specific date (defaults to today)
export async function getCanteenStatus(date?: Date): Promise<CanteenStatus> {
  const targetDate = date || new Date();
  const dayOfWeek = targetDate.getDay(); // 0 = Sunday, 6 = Saturday
  const dateStr = formatDateLocal(targetDate);
  
  // Check if holiday first (holidays override everything)
  const holiday = await checkHoliday(targetDate);
  if (holiday) {
    return { isOpen: false, reason: 'holiday', holidayName: holiday.name, date: dateStr };
  }
  
  // Check if weekend
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    // For Saturday, check if it's a make-up day
    if (dayOfWeek === 6) {
      const makeupDay = await checkMakeupDay(targetDate);
      if (makeupDay) {
        return { 
          isOpen: true, 
          date: dateStr, 
          isMakeupDay: true, 
          makeupDayName: makeupDay.name 
        };
      }
    }
    return { isOpen: false, reason: 'weekend', date: dateStr };
  }
  
  return { isOpen: true, date: dateStr };
}

// WeekdayInfo type for getWeekdaysWithStatus
export interface WeekdayInfo {
  date: Date;
  dateStr: string;
  isOpen: boolean;
  isHoliday: boolean;
  holidayName?: string;
  isMakeupDay?: boolean;
  makeupDayName?: string;
  isSaturday?: boolean;
}

// Get remaining school days of the current week with their status.
// Shows Mon–Fri (+ any makeup Saturday) of the current week, starting from today.
// If today is a regular Saturday or Sunday, shows the following Mon–Fri(+Sat) instead.
export async function getWeekdaysWithStatus(): Promise<WeekdayInfo[]> {
  const weekdays: WeekdayInfo[] = [];
  const today = getPhilippineToday();
  const todayStr = formatDateLocal(today);
  
  // Fetch holidays and makeup days in parallel
  const [{ data: holidays }, { data: makeupDays }] = await Promise.all([
    supabase.from('holidays').select('date, name, is_recurring'),
    supabase.from('makeup_days').select('date, name, reason').gte('date', todayStr),
  ]);
  
  // Build lookup maps
  const exactHolidayDates = new Map<string, string>();
  const recurringMonthDays = new Map<string, string>();
  holidays?.forEach(h => {
    const d = h.date.split('T')[0];
    if (h.is_recurring) recurringMonthDays.set(d.slice(5), h.name);
    else exactHolidayDates.set(d, h.name);
  });
  
  const makeupDayMap = new Map<string, string>();
  makeupDays?.forEach(m => makeupDayMap.set(m.date.split('T')[0], m.name));

  // Determine the start of the school week window
  const startDate = new Date(today);
  const dow = startDate.getDay();
  if (dow === 0) {
    // Sunday → next Monday
    startDate.setDate(startDate.getDate() + 1);
  } else if (dow === 6 && !makeupDayMap.has(formatDateLocal(startDate))) {
    // Regular Saturday → next Monday
    startDate.setDate(startDate.getDate() + 2);
  }

  // End of the school week = the Saturday of the week that startDate falls in
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + (6 - startDate.getDay()));

  // Walk startDate → endDate (inclusive), collecting valid school days
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const dayOfWeek = cursor.getDay();
    const dateStr = formatDateLocal(cursor);
    const monthDay = dateStr.slice(5);

    const holidayName = exactHolidayDates.get(dateStr) || recurringMonthDays.get(monthDay);
    const isHoliday = !!holidayName;
    const isSaturday = dayOfWeek === 6;
    const makeupDayName = makeupDayMap.get(dateStr);
    const isMakeupDay = isSaturday && !!makeupDayName;

    // Include Mon–Fri and makeup Saturdays; skip Sundays and regular Saturdays
    if (dayOfWeek !== 0 && (!isSaturday || isMakeupDay)) {
      weekdays.push({
        date: new Date(cursor),
        dateStr,
        isOpen: !isHoliday,
        isHoliday,
        holidayName,
        isMakeupDay,
        makeupDayName,
        isSaturday,
      });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return weekdays;
}

// Get available order dates for the current week (reuses getWeekdaysWithStatus)
export async function getAvailableOrderDates(): Promise<Date[]> {
  const weekdays = await getWeekdaysWithStatus();
  return weekdays.filter(w => w.isOpen).map(w => w.date);
}

// Get products available for a specific date based on menu schedule
export async function getProductsForDate(date: Date): Promise<Product[]> {
  const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const dateStr = formatDateLocal(date);
  
  // Check for holiday first (including recurring) - holidays close canteen
  const holiday = await checkHoliday(date);
  if (holiday) {
    return []; // Holiday - canteen closed
  }
  
  // Weekend check
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    // Sunday always closed
    if (dayOfWeek === 0) {
      return [];
    }
    // Saturday - check if it's a make-up day
    const { data: makeupDay } = await supabase
      .from('makeup_days')
      .select('id')
      .eq('date', dateStr)
      .maybeSingle();
    
    if (!makeupDay) {
      return []; // Regular Saturday - closed
    }
    // Make-up Saturday - continue to fetch menu
  }
  
  // Check for date-specific menu schedules (date-based system)
  const { data: dateSchedules, error: scheduleError } = await supabase
    .from('menu_schedules')
    .select('product_id')
    .eq('scheduled_date', dateStr)
    .eq('is_active', true);
  
  if (scheduleError) throw scheduleError;
  
  // If no menu is scheduled for this date, return empty array
  // Admin must explicitly set menu for each date
  if (!dateSchedules || dateSchedules.length === 0) {
    return [];
  }
  
  // Get only products scheduled for that date
  const productIds = dateSchedules.map(s => s.product_id);
  const { data, error } = await supabase
    .from('products')
    .select('id, name, description, price, category, image_url, available, stock_quantity')
    .eq('available', true)
    .in('id', productIds)
    .order('category', { ascending: true });

  if (error) throw error;
  return data || [];
}

// Get products available today (shorthand)
export async function getProducts(): Promise<Product[]> {
  return getProductsForDate(new Date());
}

// Get all products (for admin pages)
export async function getAllProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, description, price, category, image_url, available, stock_quantity')
    .order('category', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function getProductById(id: string): Promise<Product | null> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, description, price, category, image_url, available, stock_quantity')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

// Get menu schedules for all days
export async function getMenuSchedules(): Promise<MenuSchedule[]> {
  const { data, error } = await supabase
    .from('menu_schedules')
    .select('id, product_id, day_of_week, is_active')
    .eq('is_active', true);

  if (error) throw error;
  return data || [];
}