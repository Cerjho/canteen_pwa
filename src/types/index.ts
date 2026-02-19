// Type definitions for the Canteen PWA

// Database types matching Supabase schema
export interface Parent {
  id: string;
  email: string;
  phone_number?: string;
  first_name: string;
  last_name: string;
  balance: number;
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

// @deprecated Use Student instead - kept for backward compatibility
export interface Child {
  id: string;
  student_id?: string;
  parent_id?: string;  // No longer in students table, exists in parent_students join
  first_name: string;
  last_name: string;
  grade_level: string;
  section?: string;
  dietary_restrictions?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: ProductCategory;
  image_url: string;
  available: boolean;
  stock_quantity: number;
  created_at: string;
  updated_at: string;
}

export type ProductCategory = 'mains' | 'snacks' | 'drinks';

export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled' | 'awaiting_payment';

export type PaymentMethod = 'cash' | 'balance' | 'gcash' | 'paymongo';

export type PaymentStatus = 'awaiting_payment' | 'paid' | 'timeout' | 'refunded';

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
  created_at: string;
}

export interface Transaction {
  id: string;
  parent_id: string;
  order_id?: string;
  type: 'payment' | 'refund' | 'topup';
  amount: number;
  method: PaymentMethod;
  status: 'pending' | 'completed' | 'failed';
  reference_id?: string;
  created_at: string;
}

// Frontend types
export interface CartItem {
  id: string;
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  image_url: string;
}

// API types
export interface CreateOrderRequest {
  parent_id: string;
  student_id: string;
  client_order_id: string;
  items: Array<{
    product_id: string;
    quantity: number;
    price_at_order: number;
  }>;
  payment_method: string;
  notes?: string;
  scheduled_for?: string;
}

export interface OrderWithDetails extends Order {
  student?: Pick<Student, 'first_name' | 'last_name'>;
  // @deprecated Use 'student' instead - kept for backward compatibility
  child?: Pick<Child, 'first_name' | 'last_name'>;
  items: Array<OrderItem & {
    product: Pick<Product, 'name' | 'image_url'>;
  }>;
}

// User role from JWT
export type UserRole = 'parent' | 'staff' | 'admin';
