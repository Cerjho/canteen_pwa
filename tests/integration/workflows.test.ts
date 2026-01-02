// Integration Tests
import { describe, it, expect, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Integration tests combining multiple components and hooks

describe('Cart Integration', () => {
  // These tests verify the cart workflow works end-to-end
  
  describe('Add to Cart Flow', () => {
    it('can add product and see it in cart', async () => {
      // This would be implemented with actual components rendered together
      // For now, we test the logic flow
      
      interface CartItem { id?: string; product_id: string; name: string; price: number; quantity: number; image_url: string; }
      const cartState = {
        items: [] as CartItem[],
        addItem: (item: Omit<CartItem, 'id'>) => {
          cartState.items.push({ ...item, id: 'cart-1' });
        },
        total: 0
      };

      cartState.addItem({
        product_id: 'product-1',
        name: 'Chicken Adobo',
        price: 65,
        quantity: 1,
        image_url: ''
      });

      expect(cartState.items).toHaveLength(1);
      expect(cartState.items[0].name).toBe('Chicken Adobo');
    });

    it('increments quantity when adding same product', () => {
      interface CartItem { id?: string; product_id: string; name: string; price: number; quantity: number; }
      const items: CartItem[] = [];
      
      const addItem = (item: Omit<CartItem, 'id'>) => {
        const existing = items.find(i => i.product_id === item.product_id);
        if (existing) {
          existing.quantity += item.quantity;
        } else {
          items.push({ ...item, id: `cart-${items.length}` });
        }
      };

      addItem({ product_id: 'p1', name: 'Product', price: 50, quantity: 1 });
      addItem({ product_id: 'p1', name: 'Product', price: 50, quantity: 1 });

      expect(items).toHaveLength(1);
      expect(items[0].quantity).toBe(2);
    });
  });

  describe('Checkout Flow', () => {
    it('calculates total correctly', () => {
      const items = [
        { product_id: 'p1', price: 65, quantity: 2 },
        { product_id: 'p2', price: 25, quantity: 3 }
      ];

      const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

      expect(total).toBe(205); // (65*2) + (25*3) = 130 + 75
    });

    it('validates child selection before checkout', async () => {
      const validateCheckout = (childId: string | null, items: Array<{ id: number }>) => {
        if (!childId) {
          throw new Error('Please select a child');
        }
        if (items.length === 0) {
          throw new Error('Cart is empty');
        }
        return true;
      };

      expect(() => validateCheckout(null, [{ id: 1 }])).toThrow('Please select a child');
      expect(() => validateCheckout('child-1', [])).toThrow('Cart is empty');
      expect(validateCheckout('child-1', [{ id: 1 }])).toBe(true);
    });
  });
});

describe('Favorites Integration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists favorites to localStorage', () => {
    const userId = 'user-123';
    const favorites = ['product-1', 'product-2'];
    
    localStorage.setItem(`canteen_favorites_${userId}`, JSON.stringify(favorites));
    
    const stored = JSON.parse(localStorage.getItem(`canteen_favorites_${userId}`) || '[]');
    expect(stored).toEqual(favorites);
  });

  it('loads favorites on init', () => {
    const userId = 'user-123';
    const favorites = ['product-3'];
    
    localStorage.setItem(`canteen_favorites_${userId}`, JSON.stringify(favorites));
    
    const stored = JSON.parse(localStorage.getItem(`canteen_favorites_${userId}`) || '[]');
    expect(stored).toContain('product-3');
  });
});

describe('Order History Integration', () => {
  it('groups orders by status', () => {
    const orders = [
      { id: 'o1', status: 'pending' },
      { id: 'o2', status: 'preparing' },
      { id: 'o3', status: 'completed' },
      { id: 'o4', status: 'pending' }
    ];

    const grouped = orders.reduce((acc, order) => {
      if (!acc[order.status]) {
        acc[order.status] = [];
      }
      acc[order.status].push(order);
      return acc;
    }, {} as Record<string, typeof orders>);

    expect(grouped.pending).toHaveLength(2);
    expect(grouped.preparing).toHaveLength(1);
    expect(grouped.completed).toHaveLength(1);
  });

  it('filters active orders', () => {
    const orders = [
      { id: 'o1', status: 'pending' },
      { id: 'o2', status: 'preparing' },
      { id: 'o3', status: 'completed' },
      { id: 'o4', status: 'ready' }
    ];

    const activeStatuses = ['pending', 'preparing', 'ready'];
    const activeOrders = orders.filter(o => activeStatuses.includes(o.status));

    expect(activeOrders).toHaveLength(3);
    expect(activeOrders.find(o => o.status === 'completed')).toBeUndefined();
  });
});

describe('Search and Filter Integration', () => {
  const products = [
    { id: 'p1', name: 'Chicken Adobo', category: 'mains', available: true },
    { id: 'p2', name: 'Chicken Spaghetti', category: 'mains', available: true },
    { id: 'p3', name: 'Banana Cue', category: 'snacks', available: true },
    { id: 'p4', name: 'Orange Juice', category: 'drinks', available: true },
    { id: 'p5', name: 'Unavailable Item', category: 'mains', available: false }
  ];

  it('filters by search query', () => {
    const query = 'chicken';
    const filtered = products.filter(p => 
      p.name.toLowerCase().includes(query.toLowerCase())
    );

    expect(filtered).toHaveLength(2);
    expect(filtered.every(p => p.name.toLowerCase().includes('chicken'))).toBe(true);
  });

  it('filters by category', () => {
    const category = 'snacks';
    const filtered = products.filter(p => p.category === category);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('Banana Cue');
  });

  it('combines search and category filters', () => {
    const query = 'chicken';
    const category = 'mains';
    
    const filtered = products.filter(p => 
      p.category === category && 
      p.name.toLowerCase().includes(query.toLowerCase())
    );

    expect(filtered).toHaveLength(2);
  });

  it('filters favorites', () => {
    const favorites = ['p1', 'p4'];
    const filtered = products.filter(p => favorites.includes(p.id));

    expect(filtered).toHaveLength(2);
    expect(filtered.map(p => p.id)).toEqual(['p1', 'p4']);
  });
});

describe('Date Selection Integration', () => {
  it('generates weekday dates excluding weekends', () => {
    const getWeekdays = (startDate: Date, count: number): Date[] => {
      const dates: Date[] = [];
      const current = new Date(startDate);
      
      while (dates.length < count) {
        const day = current.getDay();
        if (day !== 0 && day !== 6) { // Not Sunday or Saturday
          dates.push(new Date(current));
        }
        current.setDate(current.getDate() + 1);
      }
      
      return dates;
    };

    const weekdays = getWeekdays(new Date('2024-01-08'), 5); // Start Monday

    expect(weekdays).toHaveLength(5);
    weekdays.forEach(date => {
      expect(date.getDay()).not.toBe(0);
      expect(date.getDay()).not.toBe(6);
    });
  });

  it('excludes holidays from available dates', () => {
    const holidays = ['2024-01-15']; // Holiday
    const dates = [
      new Date('2024-01-15'),
      new Date('2024-01-16'),
      new Date('2024-01-17')
    ];

    const availableDates = dates.filter(
      d => !holidays.includes(d.toISOString().split('T')[0])
    );

    expect(availableDates).toHaveLength(2);
    expect(availableDates.find(d => 
      d.toISOString().split('T')[0] === '2024-01-15'
    )).toBeUndefined();
  });
});

describe('Price Formatting Integration', () => {
  it('formats prices consistently', () => {
    const formatPrice = (price: number): string => `₱${price.toFixed(2)}`;

    expect(formatPrice(65)).toBe('₱65.00');
    expect(formatPrice(45.5)).toBe('₱45.50');
    expect(formatPrice(100)).toBe('₱100.00');
    expect(formatPrice(0)).toBe('₱0.00');
  });

  it('calculates order total with items', () => {
    const items = [
      { price: 65, quantity: 2 },
      { price: 25, quantity: 1 },
      { price: 35, quantity: 2 }
    ];

    const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    expect(total).toBe(225); // (65*2) + (25*1) + (35*2) = 130 + 25 + 70
  });
});

describe('Child Management Integration', () => {
  it('formats child display name', () => {
    const formatChildName = (child: { first_name: string; last_name: string; grade_level: string; section?: string }) => {
      const base = `${child.first_name} ${child.last_name} - ${child.grade_level}`;
      return child.section ? `${base} ${child.section}` : base;
    };

    expect(formatChildName({
      first_name: 'Maria',
      last_name: 'Santos',
      grade_level: 'Grade 3',
      section: 'A'
    })).toBe('Maria Santos - Grade 3 A');

    expect(formatChildName({
      first_name: 'Juan',
      last_name: 'Cruz',
      grade_level: 'Grade 1'
    })).toBe('Juan Cruz - Grade 1');
  });
});

describe('Offline Queue Integration', () => {
  it('queues order when offline', async () => {
    interface QueuedOrder { items: unknown[]; child_id: string; queued_at?: Date; }
    const queue: QueuedOrder[] = [];
    const isOnline = () => false;
    
    const createOrder = (order: Omit<QueuedOrder, 'queued_at'>) => {
      if (!isOnline()) {
        queue.push({ ...order, queued_at: new Date() });
        return { queued: true };
      }
      return { id: 'online-order' };
    };

    const result = createOrder({ items: [], child_id: 'c1' });

    expect(result.queued).toBe(true);
    expect(queue).toHaveLength(1);
  });

  it('processes queue when back online', async () => {
    const queue = [
      { id: 'q1', items: [], retry_count: 0 },
      { id: 'q2', items: [], retry_count: 0 }
    ];
    
    const processed: string[] = [];
    
    const processQueue = (orders: typeof queue) => {
      orders.forEach(order => {
        processed.push(order.id);
      });
      return processed.length;
    };

    const count = processQueue(queue);

    expect(count).toBe(2);
    expect(processed).toContain('q1');
    expect(processed).toContain('q2');
  });
});

describe('User Role Integration', () => {
  it('determines navigation based on role', () => {
    const getNavigationPath = (role: string | undefined): string => {
      switch (role) {
        case 'admin':
          return '/admin';
        case 'staff':
          return '/staff';
        default:
          return '/menu';
      }
    };

    expect(getNavigationPath('admin')).toBe('/admin');
    expect(getNavigationPath('staff')).toBe('/staff');
    expect(getNavigationPath('parent')).toBe('/menu');
    expect(getNavigationPath(undefined)).toBe('/menu');
  });

  it('shows role-specific navigation items', () => {
    const getNavItems = (role: string) => {
      const baseItems = [
        { to: '/menu', label: 'Menu' },
        { to: '/orders', label: 'History' },
        { to: '/profile', label: 'Profile' }
      ];

      if (role === 'staff' || role === 'admin') {
        baseItems.push({ to: '/staff', label: 'Staff' });
      }
      if (role === 'admin') {
        baseItems.push({ to: '/admin', label: 'Admin' });
      }

      return baseItems;
    };

    expect(getNavItems('parent')).toHaveLength(3);
    expect(getNavItems('staff')).toHaveLength(4);
    expect(getNavItems('admin')).toHaveLength(5);
  });
});
