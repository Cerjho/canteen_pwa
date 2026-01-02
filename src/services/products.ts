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

// Helper to format date as YYYY-MM-DD in LOCAL timezone (not UTC)
function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Check if a date matches a holiday (including recurring holidays)
async function checkHoliday(targetDate: Date): Promise<{ name: string } | null> {
  const dateStr = formatDateLocal(targetDate);
  const monthDay = dateStr.slice(5); // Extract MM-DD (e.g., "12-25" for Christmas)
  
  // Check for exact date match (non-recurring holidays)
  const { data: exactHoliday } = await supabase
    .from('holidays')
    .select('name, is_recurring')
    .eq('date', dateStr)
    .maybeSingle();
  
  if (exactHoliday) {
    return { name: exactHoliday.name };
  }
  
  // Check for recurring holidays (match month-day pattern)
  // Get all recurring holidays and check if any match the month-day
  const { data: recurringHolidays } = await supabase
    .from('holidays')
    .select('name, date')
    .eq('is_recurring', true);
  
  if (recurringHolidays) {
    for (const holiday of recurringHolidays) {
      const holidayMonthDay = holiday.date.slice(5); // Extract MM-DD from stored date
      if (holidayMonthDay === monthDay) {
        return { name: holiday.name };
      }
    }
  }
  
  return null;
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

// Get next N school days with their status (including holidays and make-up Saturdays)
export async function getWeekdaysWithStatus(daysAhead: number = 5): Promise<WeekdayInfo[]> {
  const weekdays: WeekdayInfo[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Get ALL holidays
  const { data: holidays } = await supabase
    .from('holidays')
    .select('date, name, is_recurring');
  
  // Get ALL make-up days (Saturdays)
  const { data: makeupDays } = await supabase
    .from('makeup_days')
    .select('date, name, reason')
    .gte('date', formatDateLocal(today));
  
  // Build maps for holidays
  const exactHolidayDates = new Map<string, string>(); // date -> name
  const recurringMonthDays = new Map<string, string>(); // MM-DD -> name
  
  holidays?.forEach(h => {
    const holidayDateStr = h.date.split('T')[0];
    if (h.is_recurring) {
      recurringMonthDays.set(holidayDateStr.slice(5), h.name); // MM-DD
    } else {
      exactHolidayDates.set(holidayDateStr, h.name);
    }
  });
  
  // Build set of make-up day dates
  const makeupDayDates = new Map<string, string>(); // date -> name
  makeupDays?.forEach(m => {
    const makeupDateStr = m.date.split('T')[0];
    makeupDayDates.set(makeupDateStr, m.name);
  });
  
  let checkDate = new Date(today);
  // Continue until we have enough days (need to check more days to find make-up Saturdays)
  const maxDaysToCheck = daysAhead * 3; // Check up to 3 weeks ahead
  let daysChecked = 0;
  
  while (weekdays.length < daysAhead && daysChecked < maxDaysToCheck) {
    const dayOfWeek = checkDate.getDay();
    const dateStr = formatDateLocal(checkDate);
    const monthDay = dateStr.slice(5); // MM-DD
    
    // Check if holiday (applies to all days)
    const holidayName = exactHolidayDates.get(dateStr) || recurringMonthDays.get(monthDay);
    const isHoliday = !!holidayName;
    
    // Check if this Saturday is a make-up day
    const isSaturday = dayOfWeek === 6;
    const makeupDayName = makeupDayDates.get(dateStr);
    const isMakeupDay = isSaturday && !!makeupDayName;
    
    // Include: weekdays (Mon-Fri) OR make-up Saturdays
    // Exclude: Sundays and regular Saturdays
    if (dayOfWeek !== 0 && (dayOfWeek !== 6 || isMakeupDay)) {
      weekdays.push({
        date: new Date(checkDate),
        dateStr,
        isOpen: !isHoliday, // Holiday overrides make-up day
        isHoliday,
        holidayName,
        isMakeupDay,
        makeupDayName,
        isSaturday
      });
    }
    
    checkDate.setDate(checkDate.getDate() + 1);
    daysChecked++;
  }
  
  return weekdays;
}

// Get available order dates (next 5 weekdays excluding holidays)
export async function getAvailableOrderDates(daysAhead: number = 5): Promise<Date[]> {
  const dates: Date[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Get ALL holidays (we'll filter in code for correct matching)
  const { data: holidays } = await supabase
    .from('holidays')
    .select('date, is_recurring');
  
  // Build sets for exact dates and recurring month-days
  const exactHolidayDates = new Set<string>();
  const recurringMonthDays = new Set<string>();
  
  holidays?.forEach(h => {
    if (h.is_recurring) {
      recurringMonthDays.add(h.date.slice(5)); // MM-DD
    } else {
      exactHolidayDates.add(h.date);
    }
  });
  
  let checkDate = new Date(today);
  while (dates.length < daysAhead) {
    const dayOfWeek = checkDate.getDay();
    const dateStr = formatDateLocal(checkDate);
    const monthDay = dateStr.slice(5); // MM-DD
    
    // Skip weekends and holidays (both exact and recurring)
    const isHoliday = exactHolidayDates.has(dateStr) || recurringMonthDays.has(monthDay);
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !isHoliday) {
      dates.push(new Date(checkDate));
    }
    
    checkDate.setDate(checkDate.getDate() + 1);
  }
  
  return dates;
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
    .select('*')
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
    .select('*')
    .order('category', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function getProductById(id: string): Promise<Product | null> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

// Get menu schedules for all days
export async function getMenuSchedules(): Promise<MenuSchedule[]> {
  const { data, error } = await supabase
    .from('menu_schedules')
    .select('*')
    .eq('is_active', true);

  if (error) throw error;
  return data || [];
}