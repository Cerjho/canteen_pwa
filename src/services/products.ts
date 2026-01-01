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
}

// Check if canteen is open on a specific date (defaults to today)
export async function getCanteenStatus(date?: Date): Promise<CanteenStatus> {
  const targetDate = date || new Date();
  const dayOfWeek = targetDate.getDay(); // 0 = Sunday, 6 = Saturday
  const dateStr = targetDate.toISOString().split('T')[0];
  
  // Check if weekend
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { isOpen: false, reason: 'weekend', date: dateStr };
  }
  
  // Check if holiday
  const { data: holiday } = await supabase
    .from('holidays')
    .select('name')
    .eq('date', dateStr)
    .maybeSingle();
  
  if (holiday) {
    return { isOpen: false, reason: 'holiday', holidayName: holiday.name, date: dateStr };
  }
  
  return { isOpen: true, date: dateStr };
}

// Get available order dates (next 5 weekdays excluding holidays)
export async function getAvailableOrderDates(daysAhead: number = 5): Promise<Date[]> {
  const dates: Date[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Get holidays for the next month
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 30);
  
  const { data: holidays } = await supabase
    .from('holidays')
    .select('date')
    .gte('date', today.toISOString().split('T')[0])
    .lte('date', endDate.toISOString().split('T')[0]);
  
  const holidayDates = new Set(holidays?.map(h => h.date) || []);
  
  let checkDate = new Date(today);
  while (dates.length < daysAhead) {
    const dayOfWeek = checkDate.getDay();
    const dateStr = checkDate.toISOString().split('T')[0];
    
    // Skip weekends and holidays
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidayDates.has(dateStr)) {
      dates.push(new Date(checkDate));
    }
    
    checkDate.setDate(checkDate.getDate() + 1);
  }
  
  return dates;
}

// Get products available for a specific date based on menu schedule
export async function getProductsForDate(date: Date): Promise<Product[]> {
  const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const dateStr = date.toISOString().split('T')[0];
  
  // Weekend check - return empty (canteen closed)
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return [];
  }
  
  // Check for holiday
  const { data: holiday } = await supabase
    .from('holidays')
    .select('id')
    .eq('date', dateStr)
    .maybeSingle();
  
  if (holiday) {
    return []; // Holiday - canteen closed
  }
  
  // First check if there are any menu schedules for this day
  const { data: daySchedules, error: scheduleError } = await supabase
    .from('menu_schedules')
    .select('product_id')
    .eq('day_of_week', dayOfWeek)
    .eq('is_active', true);

  if (scheduleError) throw scheduleError;

  // If no schedules exist, return all available products (backward compatibility)
  if (!daySchedules || daySchedules.length === 0) {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('available', true)
      .order('category', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  // Get only products scheduled for that day
  const productIds = daySchedules.map(s => s.product_id);
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