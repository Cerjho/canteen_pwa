// Mock Data for Testing
import type { 
  Product, 
  Child, 
  Student,
  OrderWithDetails, 
  CartItem,
  Parent,
  OrderItem 
} from '../../src/types';

// ============================================
// Products
// ============================================
export const mockProducts: Product[] = [
  {
    id: 'product-1',
    name: 'Chicken Adobo',
    description: 'Classic Filipino chicken adobo with rice',
    price: 65.00,
    category: 'mains',
    image_url: 'https://example.com/adobo.jpg',
    available: true,
    stock_quantity: 50,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  },
  {
    id: 'product-2',
    name: 'Spaghetti',
    description: 'Sweet-style Filipino spaghetti',
    price: 55.00,
    category: 'mains',
    image_url: 'https://example.com/spaghetti.jpg',
    available: true,
    stock_quantity: 30,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  },
  {
    id: 'product-3',
    name: 'Banana Cue',
    description: 'Fried banana with caramelized sugar',
    price: 25.00,
    category: 'snacks',
    image_url: 'https://example.com/bananacue.jpg',
    available: true,
    stock_quantity: 100,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  },
  {
    id: 'product-4',
    name: 'Orange Juice',
    description: 'Fresh squeezed orange juice',
    price: 35.00,
    category: 'drinks',
    image_url: 'https://example.com/oj.jpg',
    available: true,
    stock_quantity: 20,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  },
  {
    id: 'product-5',
    name: 'Sold Out Item',
    description: 'This item is currently unavailable',
    price: 45.00,
    category: 'snacks',
    image_url: 'https://example.com/soldout.jpg',
    available: false,
    stock_quantity: 0,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  }
];

// ============================================
// Students (primary type)
// ============================================
export const mockStudents: Student[] = [
  {
    id: 'student-1',
    student_id: 'STU-001',
    first_name: 'Maria',
    last_name: 'Santos',
    grade_level: 'Grade 3',
    section: 'A',
    dietary_restrictions: 'No peanuts',
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  },
  {
    id: 'student-2',
    student_id: 'STU-002',
    first_name: 'Juan',
    last_name: 'Santos',
    grade_level: 'Grade 1',
    section: 'B',
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  }
];

export const mockStudentWithoutSection: Student = {
  id: 'student-3',
  student_id: 'STU-003',
  first_name: 'Pedro',
  last_name: 'Cruz',
  grade_level: 'Grade 2',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z'
};

// ============================================
// Children (deprecated - for backward compatibility)
// ============================================
export const mockChildren: Child[] = [
  {
    id: 'student-1',
    student_id: 'STU-001',
    parent_id: 'test-user-123',
    first_name: 'Maria',
    last_name: 'Santos',
    grade_level: 'Grade 3',
    section: 'A',
    dietary_restrictions: 'No peanuts',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  },
  {
    id: 'student-2',
    student_id: 'STU-002',
    parent_id: 'test-user-123',
    first_name: 'Juan',
    last_name: 'Santos',
    grade_level: 'Grade 1',
    section: 'B',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  }
];

export const mockChildWithoutSection: Child = {
  id: 'student-3',
  student_id: 'STU-003',
  parent_id: 'test-user-123',
  first_name: 'Pedro',
  last_name: 'Cruz',
  grade_level: 'Grade 2',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z'
};

// ============================================
// Cart Items
// ============================================
export const mockCartItems: CartItem[] = [
  {
    id: 'cart-1',
    product_id: 'product-1',
    name: 'Chicken Adobo',
    price: 65.00,
    quantity: 2,
    image_url: 'https://example.com/adobo.jpg'
  },
  {
    id: 'cart-2',
    product_id: 'product-3',
    name: 'Banana Cue',
    price: 25.00,
    quantity: 3,
    image_url: 'https://example.com/bananacue.jpg'
  }
];

// ============================================
// Orders
// ============================================
export const mockOrderItems: (OrderItem & { product: Pick<Product, 'name' | 'image_url'> })[] = [
  {
    id: 'item-1',
    order_id: 'order-1',
    product_id: 'product-1',
    quantity: 2,
    price_at_order: 65.00,
    created_at: '2024-01-01T10:00:00Z',
    product: {
      name: 'Chicken Adobo',
      image_url: 'https://example.com/adobo.jpg'
    }
  },
  {
    id: 'item-2',
    order_id: 'order-1',
    product_id: 'product-3',
    quantity: 1,
    price_at_order: 25.00,
    created_at: '2024-01-01T10:00:00Z',
    product: {
      name: 'Banana Cue',
      image_url: 'https://example.com/bananacue.jpg'
    }
  }
];

export const mockOrders: OrderWithDetails[] = [
  {
    id: 'order-1',
    parent_id: 'test-user-123',
    student_id: 'student-1',
    client_order_id: 'client-order-1',
    status: 'pending',
    total_amount: 155.00,
    payment_method: 'cash',
    notes: 'No spicy please',
    created_at: '2024-01-01T10:00:00Z',
    updated_at: '2024-01-01T10:00:00Z',
    student: {
      first_name: 'Maria',
      last_name: 'Santos'
    },
    child: {
      first_name: 'Maria',
      last_name: 'Santos'
    },
    items: mockOrderItems
  },
  {
    id: 'order-2',
    parent_id: 'test-user-123',
    student_id: 'student-2',
    client_order_id: 'client-order-2',
    status: 'preparing',
    total_amount: 90.00,
    payment_method: 'gcash',
    created_at: '2024-01-01T09:00:00Z',
    updated_at: '2024-01-01T09:30:00Z',
    student: {
      first_name: 'Juan',
      last_name: 'Santos'
    },
    child: {
      first_name: 'Juan',
      last_name: 'Santos'
    },
    items: [
      {
        id: 'item-3',
        order_id: 'order-2',
        product_id: 'product-2',
        quantity: 1,
        price_at_order: 55.00,
        created_at: '2024-01-01T09:00:00Z',
        product: {
          name: 'Spaghetti',
          image_url: 'https://example.com/spaghetti.jpg'
        }
      },
      {
        id: 'item-4',
        order_id: 'order-2',
        product_id: 'product-4',
        quantity: 1,
        price_at_order: 35.00,
        created_at: '2024-01-01T09:00:00Z',
        product: {
          name: 'Orange Juice',
          image_url: 'https://example.com/oj.jpg'
        }
      }
    ]
  },
  {
    id: 'order-3',
    parent_id: 'test-user-123',
    student_id: 'student-1',
    client_order_id: 'client-order-3',
    status: 'completed',
    total_amount: 65.00,
    payment_method: 'balance',
    created_at: '2023-12-31T12:00:00Z',
    updated_at: '2023-12-31T12:30:00Z',
    completed_at: '2023-12-31T12:30:00Z',
    student: {
      first_name: 'Maria',
      last_name: 'Santos'
    },
    child: {
      first_name: 'Maria',
      last_name: 'Santos'
    },
    items: [
      {
        id: 'item-5',
        order_id: 'order-3',
        product_id: 'product-1',
        quantity: 1,
        price_at_order: 65.00,
        created_at: '2023-12-31T12:00:00Z',
        product: {
          name: 'Chicken Adobo',
          image_url: 'https://example.com/adobo.jpg'
        }
      }
    ]
  }
];

// ============================================
// Parent
// ============================================
export const mockParent: Parent = {
  id: 'test-user-123',
  email: 'parent@test.com',
  phone_number: '+639123456789',
  first_name: 'Test',
  last_name: 'Parent',
  balance: 500.00,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z'
};

// ============================================
// Menu Schedules
// ============================================
export const mockMenuSchedules = [
  { id: 'schedule-1', product_id: 'product-1', day_of_week: 1, is_active: true }, // Monday
  { id: 'schedule-2', product_id: 'product-2', day_of_week: 1, is_active: true },
  { id: 'schedule-3', product_id: 'product-3', day_of_week: 1, is_active: true },
  { id: 'schedule-4', product_id: 'product-1', day_of_week: 2, is_active: true }, // Tuesday
  { id: 'schedule-5', product_id: 'product-4', day_of_week: 2, is_active: true },
];

// ============================================
// Holidays
// ============================================
export const mockHolidays = [
  { id: 'holiday-1', date: '2024-12-25', name: 'Christmas Day' },
  { id: 'holiday-2', date: '2024-12-30', name: 'Rizal Day' },
  { id: 'holiday-3', date: '2025-01-01', name: 'New Year\'s Day' }
];

// ============================================
// Queued Orders (Offline)
// ============================================
export const mockQueuedOrders = [
  {
    id: 'queued-1',
    parent_id: 'test-user-123',
    student_id: 'student-1',
    client_order_id: 'client-queued-1',
    items: [
      { product_id: 'product-1', quantity: 1, price_at_order: 65.00 }
    ],
    payment_method: 'cash',
    notes: 'Offline order',
    queued_at: new Date('2024-01-01T10:00:00Z'),
    retry_count: 0
  }
];
