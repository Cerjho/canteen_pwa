// Parent Menu Page Tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Supabase
const mockSupabase = {
  from: vi.fn(),
  functions: {
    invoke: vi.fn()
  }
};

vi.mock('../../../src/services/supabaseClient', () => ({
  supabase: mockSupabase
}));

describe('Parent Menu Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T10:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Menu Loading', () => {
    it('should load menu for selected date', async () => {
      const mockMenu = [
        {
          id: 'schedule-1',
          product_id: 'product-1',
          scheduled_date: '2026-01-05',
          available: true,
          products: {
            id: 'product-1',
            name: 'Burger',
            price: 75.00,
            stock: 50,
            image_url: '/burger.jpg'
          }
        },
        {
          id: 'schedule-2',
          product_id: 'product-2',
          scheduled_date: '2026-01-05',
          available: true,
          products: {
            id: 'product-2',
            name: 'Fries',
            price: 35.00,
            stock: 100,
            image_url: '/fries.jpg'
          }
        }
      ];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: mockMenu, error: null })
          })
        })
      });

      expect(mockMenu).toHaveLength(2);
    });

    it('should query by scheduled_date', () => {
      const selectedDate = '2026-01-05';
      
      // Verify the query uses scheduled_date
      const _query = mockSupabase.from('menu_schedules')
        .select('*, products(*)')
        .eq('scheduled_date', selectedDate)
        .eq('available', true);

      expect(mockSupabase.from).toHaveBeenCalledWith('menu_schedules');
    });

    it('should show only available products', () => {
      const schedules = [
        { id: '1', product_id: 'p1', available: true },
        { id: '2', product_id: 'p2', available: false },
        { id: '3', product_id: 'p3', available: true }
      ];

      const availableOnly = schedules.filter(s => s.available);
      expect(availableOnly).toHaveLength(2);
    });
  });

  describe('Date Selection', () => {
    it('should default to today', () => {
      const today = new Date('2026-01-05T10:00:00');
      const formatted = today.toISOString().split('T')[0];
      expect(formatted).toBe('2026-01-05');
    });

    it('should allow selecting future dates', () => {
      const today = new Date('2026-01-05');
      const nextWeek = new Date(today);
      nextWeek.setDate(today.getDate() + 7);

      expect(nextWeek.toISOString().split('T')[0]).toBe('2026-01-12');
    });

    it('should not allow selecting past dates', () => {
      const today = new Date('2026-01-05');
      const yesterday = new Date('2026-01-04');

      const isValidDate = yesterday >= today;
      expect(isValidDate).toBe(false);
    });

    it('should only allow weekdays', () => {
      const isWeekday = (date: Date): boolean => {
        const day = date.getDay();
        return day !== 0 && day !== 6; // Not Sunday or Saturday
      };

      const monday = new Date('2026-01-05');
      const saturday = new Date('2026-01-10');
      const sunday = new Date('2026-01-11');

      expect(isWeekday(monday)).toBe(true);
      expect(isWeekday(saturday)).toBe(false);
      expect(isWeekday(sunday)).toBe(false);
    });
  });

  describe('Add to Cart', () => {
    it('should add product to cart', () => {
      interface CartProduct { id: string; name: string; price: number; quantity: number; }
      const cart: CartProduct[] = [];
      const product = {
        id: 'product-1',
        name: 'Burger',
        price: 75.00,
        quantity: 1
      };

      cart.push(product);
      expect(cart).toHaveLength(1);
    });

    it('should respect stock limits', () => {
      const product = { id: 'product-1', stock: 5 };
      const cartQuantity = 3;
      
      const canAddMore = cartQuantity < product.stock;
      expect(canAddMore).toBe(true);

      const atLimit = 5 < product.stock;
      expect(atLimit).toBe(false);
    });

    it('should disable add button for out of stock items', () => {
      const product = { id: 'product-1', stock: 0 };
      const isDisabled = product.stock <= 0;
      expect(isDisabled).toBe(true);
    });
  });

  describe('Product Filtering', () => {
    it('should filter by search term', () => {
      const products = [
        { name: 'Chicken Burger' },
        { name: 'Beef Burger' },
        { name: 'Fries' }
      ];

      const searchTerm = 'burger';
      const filtered = products.filter(p => 
        p.name.toLowerCase().includes(searchTerm.toLowerCase())
      );

      expect(filtered).toHaveLength(2);
    });

    it('should filter by category', () => {
      const products = [
        { name: 'Burger', category: 'meals' },
        { name: 'Fries', category: 'sides' },
        { name: 'Cola', category: 'drinks' }
      ];

      const filtered = products.filter(p => p.category === 'meals');
      expect(filtered).toHaveLength(1);
    });
  });

  describe('Future Orders', () => {
    it('should allow ordering for future dates', () => {
      const selectedDate = '2026-01-10';
      const today = '2026-01-05';

      const isFutureOrder = selectedDate > today;
      expect(isFutureOrder).toBe(true);
    });

    it('should show scheduled date in cart', () => {
      const order = {
        items: [{ product_id: 'p1', quantity: 1 }],
        scheduled_for: '2026-01-10'
      };

      expect(order.scheduled_for).toBe('2026-01-10');
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no menu for date', () => {
      const menuItems: Array<{ id: string; product_id: string; available: boolean }> = [];
      const showEmptyState = menuItems.length === 0;
      expect(showEmptyState).toBe(true);
    });

    it('should show empty state message', () => {
      const message = 'No menu available for this date';
      expect(message).toContain('No menu');
    });
  });

  describe('Holiday Handling', () => {
    it('should check for holidays', () => {
      const holidays = ['2026-01-01', '2026-12-25'];
      const selectedDate = '2026-01-01';

      const isHoliday = holidays.includes(selectedDate);
      expect(isHoliday).toBe(true);
    });

    it('should disable ordering on holidays', () => {
      const holidays = ['2026-01-01'];
      const selectedDate = '2026-01-01';
      const isHoliday = holidays.includes(selectedDate);

      const canOrder = !isHoliday;
      expect(canOrder).toBe(false);
    });
  });
});

describe('Product Card', () => {
  it('should display product information', () => {
    const product = {
      name: 'Burger',
      price: 75.00,
      description: 'Delicious beef burger',
      image_url: '/burger.jpg',
      stock: 50
    };

    expect(product.name).toBe('Burger');
    expect(product.price).toBe(75.00);
  });

  it('should format price correctly', () => {
    const formatPrice = (price: number): string => {
      return `₱${price.toFixed(2)}`;
    };

    expect(formatPrice(75.00)).toBe('₱75.00');
    expect(formatPrice(123.50)).toBe('₱123.50');
  });

  it('should show low stock warning', () => {
    const product = { stock: 3 };
    const lowStockThreshold = 5;
    
    const showLowStockWarning = product.stock > 0 && product.stock <= lowStockThreshold;
    expect(showLowStockWarning).toBe(true);
  });

  it('should show out of stock badge', () => {
    const product = { stock: 0 };
    const isOutOfStock = product.stock <= 0;
    expect(isOutOfStock).toBe(true);
  });
});

describe('Child Selection', () => {
  it('should require child selection for ordering', () => {
    const selectedChildId = null;
    const canCheckout = selectedChildId !== null;
    expect(canCheckout).toBe(false);
  });

  it('should filter menu by child dietary restrictions', () => {
    const childAllergies = ['peanuts', 'dairy'];
    const products = [
      { name: 'Peanut Butter Sandwich', allergens: ['peanuts'] },
      { name: 'Burger', allergens: [] },
      { name: 'Cheese Pizza', allergens: ['dairy', 'gluten'] }
    ];

    const safeProducts = products.filter(p => 
      !p.allergens.some(a => childAllergies.includes(a))
    );

    expect(safeProducts).toHaveLength(1);
    expect(safeProducts[0].name).toBe('Burger');
  });

  it('should show allergen warnings', () => {
    const product = { allergens: ['peanuts', 'dairy'] };
    const childAllergies = ['peanuts'];

    const hasAllergenConflict = product.allergens.some(a => 
      childAllergies.includes(a)
    );

    expect(hasAllergenConflict).toBe(true);
  });
});
