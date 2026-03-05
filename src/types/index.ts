// Type definitions for the Canteen PWA — Loheca Weekly Pre-Order System

// Database types matching Supabase schema
export interface Parent {
  id: string;
  email: string;
  phone_number?: string;
  first_name: string;
  last_name: string;
  created_at: string;
  updated_at: string;
}

// Student - matches 'students' table
export interface Student {
  id: string;
  student_id: string;  // School-assigned student ID
  first_name: string;
  last_name: string;
  grade_level: string;
  section?: string;
  dietary_restrictions?: string;
  is_active: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

// Parent-Student relationship - matches 'parent_students' join table
export interface ParentStudent {
  id: string;
  parent_id: string;
  student_id: string;
  relationship?: string;
  is_primary: boolean;
  linked_at: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: ProductCategory;
  image_url: string;
  available: boolean;
  created_at: string;
  updated_at: string;
}

export type ProductCategory = 'mains' | 'snacks' | 'drinks';

// Meal period - determines when food is served
export type MealPeriod = 'morning_snack' | 'lunch' | 'afternoon_snack';

export const MEAL_PERIOD_LABELS: Record<MealPeriod, string> = {
  morning_snack: 'Morning Snack',
  lunch: 'Lunch',
  afternoon_snack: 'Afternoon Snack',
};

export const MEAL_PERIOD_ICONS: Record<MealPeriod, string> = {
  morning_snack: '🌅',
  lunch: '☀️',
  afternoon_snack: '🌆',
};

/**
 * Auto-assign meal period based on product category:
 * - mains → lunch (always)
 * - drinks → afternoon_snack (always)
 * - snacks → null (requires user selection via popup)
 */
export function autoMealPeriod(category: ProductCategory): MealPeriod | null {
  switch (category) {
    case 'mains': return 'lunch';
    case 'drinks': return null; // User must choose
    case 'snacks': return null; // User must choose
  }
}

export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled' | 'awaiting_payment';

export type PaymentMethod = 'cash' | 'gcash' | 'paymaya' | 'card';

/** Payment methods that require online checkout via PayMongo */
export const ONLINE_PAYMENT_METHODS: PaymentMethod[] = ['gcash', 'paymaya', 'card'];

/** Check if a payment method requires online checkout */
export function isOnlinePaymentMethod(method: string): boolean {
  return ONLINE_PAYMENT_METHODS.includes(method as PaymentMethod);
}

export type PaymentStatus = 'awaiting_payment' | 'paid' | 'timeout' | 'refunded' | 'failed';

/** Transaction record from the payments table */
export interface Transaction {
  id: string;
  parent_id: string;
  order_id?: string;
  type: 'payment' | 'refund';
  amount: number;
  method: string;
  status: 'pending' | 'completed' | 'failed';
  external_ref?: string;
  paymongo_checkout_id?: string;
  paymongo_payment_id?: string;
  paymongo_refund_id?: string;
  payment_group_id?: string;
  reference_id?: string;
  original_payment_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

/** Order type distinguishing weekly pre-orders, surplus, and walk-in */
export type OrderType = 'pre_order' | 'surplus' | 'walk_in';

/** Status for the weekly order aggregate */
export type WeeklyOrderStatus = 'submitted' | 'active' | 'completed' | 'cancelled';

export interface Order {
  id: string;
  parent_id: string;
  student_id: string;
  client_order_id: string;
  status: OrderStatus;
  total_amount: number;
  payment_method: PaymentMethod;
  payment_status?: PaymentStatus;
  payment_due_at?: string;
  paymongo_checkout_id?: string;
  paymongo_payment_id?: string;
  payment_group_id?: string;
  weekly_order_id?: string;
  order_type?: OrderType;
  notes?: string;
  scheduled_for?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  price_at_order: number;
  status?: 'confirmed' | 'unavailable';
  meal_period?: MealPeriod;
  created_at: string;
}

/** Weekly order — aggregate container for Mon–Fri daily orders */
export interface WeeklyOrder {
  id: string;
  parent_id: string;
  student_id: string;
  week_start: string; // YYYY-MM-DD (Monday)
  status: WeeklyOrderStatus;
  total_amount: number;
  payment_method: PaymentMethod;
  payment_status?: PaymentStatus;
  paymongo_checkout_id?: string;
  paymongo_checkout_url?: string;
  payment_due_at?: string;
  notes?: string;
  submitted_at?: string;
  created_at: string;
  updated_at: string;
  // Joined data
  student?: Student;
  daily_orders?: Order[];
}

/** Surplus item marked by staff for same-day ordering */
export interface SurplusItem {
  id: string;
  product_id: string;
  scheduled_date: string;
  meal_period?: MealPeriod;
  quantity_available: number;
  surplus_price: number;
  marked_by: string;
  is_active: boolean;
  created_at: string;
  // Joined data
  product?: Product;
}

/** Payment-centric model: one row per real money movement */
export interface Payment {
  id: string;
  parent_id: string;
  type: 'payment' | 'refund';
  amount_total: number;
  method: PaymentMethod;
  status: 'pending' | 'completed' | 'failed';
  external_ref?: string;
  paymongo_checkout_id?: string;
  paymongo_payment_id?: string;
  paymongo_refund_id?: string;
  payment_group_id?: string;
  weekly_order_id?: string;
  reference_id?: string;
  original_payment_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

/** Links a payment to one or more orders */
export interface PaymentAllocation {
  id: string;
  payment_id: string;
  order_id: string;
  allocated_amount: number;
  created_at: string;
}

/** Response from the create-checkout edge function (surplus/single orders) */
export interface CreateCheckoutResponse {
  success: boolean;
  order_id: string;
  checkout_url?: string;
  payment_due_at?: string;
  total_amount: number;
  merged?: boolean;
  merged_order_ids?: string[];
}

/** Response from the process-weekly-order edge function */
export interface WeeklyOrderResponse {
  success: boolean;
  weekly_order_id: string;
  order_ids: string[];
  total_amount: number;
  payment_status: string;
  payment_due_at?: string;
  message: string;
}

/** Response from the create-weekly-checkout edge function */
export interface WeeklyCheckoutResponse {
  success: boolean;
  weekly_order_id: string;
  order_ids: string[];
  checkout_url: string;
  payment_due_at: string;
  total_amount: number;
}

/** Response from the process-surplus-order edge function */
export interface SurplusOrderResponse {
  success: boolean;
  order_id: string;
  checkout_url?: string;
  payment_due_at?: string;
  total_amount: number;
  message: string;
}

/** Response from the check-payment-status edge function */
export interface PaymentStatusResponse {
  order_id?: string;
  payment_status?: PaymentStatus;
  order_status?: OrderStatus;
  payment_method?: PaymentMethod;
  total_amount?: number;
}

// Frontend types

/** Cart item for building a weekly order */
export interface CartItem {
  id: string;
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  image_url: string;
  meal_period?: MealPeriod;
}

/** Weekly cart day entry — items for a specific day */
export interface WeeklyCartDay {
  date: string; // YYYY-MM-DD
  items: CartItem[];
}

/** Request to create a weekly order */
export interface CreateWeeklyOrderRequest {
  parent_id: string;
  student_id: string;
  week_start: string; // Monday YYYY-MM-DD
  days: Array<{
    scheduled_for: string;
    items: Array<{
      product_id: string;
      quantity: number;
      price_at_order: number;
      meal_period?: string;
    }>;
  }>;
  payment_method: PaymentMethod;
  notes?: string;
}

/** Request to create a surplus order */
export interface CreateSurplusOrderRequest {
  parent_id: string;
  student_id: string;
  items: Array<{
    product_id: string;
    quantity: number;
    price_at_order: number;
    meal_period?: string;
  }>;
  payment_method: PaymentMethod;
}

export interface OrderWithDetails extends Order {
  meal_period?: MealPeriod;
  student?: Pick<Student, 'id' | 'first_name' | 'last_name'>;
  items: Array<OrderItem & {
    product: Pick<Product, 'name' | 'image_url'>;
  }>;
}

export interface WeeklyOrderWithDetails extends Omit<WeeklyOrder, 'student' | 'daily_orders'> {
  student?: Pick<Student, 'id' | 'first_name' | 'last_name'>;
  daily_orders?: OrderWithDetails[];
}

// User role from JWT
export type UserRole = 'parent' | 'staff' | 'admin';
