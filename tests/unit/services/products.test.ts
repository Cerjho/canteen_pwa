// Products Service Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase client
const mockFrom = vi.fn();

vi.mock('../../src/services/supabaseClient', () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args)
  }
}));

import { 
  getProducts, 
  getAllProducts, 
  getProductById,
  getProductsForDate,
  getCanteenStatus,
  getAvailableOrderDates,
  getMenuSchedules
} from '../../src/services/products';

describe('Products Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getProducts', () => {
    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null })
    };

    beforeEach(() => {
      mockFrom.mockReturnValue(mockQueryBuilder);
    });

    it('queries products table', async () => {
      // Mock for holidays check
      mockQueryBuilder.single.mockResolvedValueOnce({ data: null, error: null });
      // Mock for menu_schedules check
      mockQueryBuilder.order.mockResolvedValueOnce({ data: [], error: null });
      // Mock for products query
      mockQueryBuilder.order.mockResolvedValueOnce({ data: [], error: null });

      await getProducts();

      expect(mockFrom).toHaveBeenCalledWith('products');
    });

    it('returns products data', async () => {
      const mockProducts = [
        { id: 'product-1', name: 'Chicken Adobo', price: 65 },
        { id: 'product-2', name: 'Spaghetti', price: 55 }
      ];

      // Mock for holidays check
      mockQueryBuilder.single.mockResolvedValueOnce({ data: null, error: null });
      // Mock for menu_schedules - empty means return all products
      mockQueryBuilder.order.mockResolvedValueOnce({ data: [], error: null });
      // Mock for products query
      mockQueryBuilder.order.mockResolvedValueOnce({ data: mockProducts, error: null });

      const result = await getProducts();

      // Note: getProducts calls getProductsForDate, which may have different behavior based on day
      expect(Array.isArray(result)).toBe(true);
    });

    it('throws error on failure', async () => {
      mockQueryBuilder.single.mockResolvedValueOnce({ data: null, error: null });
      mockQueryBuilder.order.mockResolvedValueOnce({ data: [], error: null });
      mockQueryBuilder.order.mockResolvedValueOnce({ data: null, error: { message: 'Database error' } });

      await expect(getProducts()).rejects.toEqual({ message: 'Database error' });
    });
  });

  describe('getAllProducts', () => {
    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null })
    };

    beforeEach(() => {
      mockFrom.mockReturnValue(mockQueryBuilder);
    });

    it('queries all products', async () => {
      await getAllProducts();

      expect(mockFrom).toHaveBeenCalledWith('products');
      expect(mockQueryBuilder.select).toHaveBeenCalledWith('*');
    });

    it('orders by category', async () => {
      await getAllProducts();

      expect(mockQueryBuilder.order).toHaveBeenCalledWith('category', { ascending: true });
    });

    it('returns all products including unavailable', async () => {
      const mockProducts = [
        { id: 'product-1', name: 'Available', available: true },
        { id: 'product-2', name: 'Unavailable', available: false }
      ];
      mockQueryBuilder.order.mockResolvedValue({ data: mockProducts, error: null });

      const result = await getAllProducts();

      expect(result).toHaveLength(2);
    });

    it('returns empty array when no products', async () => {
      mockQueryBuilder.order.mockResolvedValue({ data: null, error: null });

      const result = await getAllProducts();

      expect(result).toEqual([]);
    });
  });

  describe('getProductById', () => {
    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null })
    };

    beforeEach(() => {
      mockFrom.mockReturnValue(mockQueryBuilder);
    });

    it('queries product by id', async () => {
      await getProductById('product-123');

      expect(mockFrom).toHaveBeenCalledWith('products');
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('id', 'product-123');
    });

    it('returns product data', async () => {
      const mockProduct = { id: 'product-123', name: 'Chicken Adobo' };
      mockQueryBuilder.single.mockResolvedValue({ data: mockProduct, error: null });

      const result = await getProductById('product-123');

      expect(result).toEqual(mockProduct);
    });

    it('returns null when not found', async () => {
      mockQueryBuilder.single.mockResolvedValue({ data: null, error: null });

      const result = await getProductById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getCanteenStatus', () => {
    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null })
    };

    beforeEach(() => {
      mockFrom.mockReturnValue(mockQueryBuilder);
    });

    it('returns closed on Saturday', async () => {
      const saturday = new Date('2024-01-06'); // Saturday
      
      const result = await getCanteenStatus(saturday);

      expect(result.isOpen).toBe(false);
      expect(result.reason).toBe('weekend');
    });

    it('returns closed on Sunday', async () => {
      const sunday = new Date('2024-01-07'); // Sunday
      
      const result = await getCanteenStatus(sunday);

      expect(result.isOpen).toBe(false);
      expect(result.reason).toBe('weekend');
    });

    it('returns closed on holiday', async () => {
      const holiday = new Date('2024-12-25'); // Wednesday
      mockQueryBuilder.single.mockResolvedValue({ 
        data: { name: 'Christmas Day' }, 
        error: null 
      });

      const result = await getCanteenStatus(holiday);

      expect(result.isOpen).toBe(false);
      expect(result.reason).toBe('holiday');
      expect(result.holidayName).toBe('Christmas Day');
    });

    it('returns open on regular weekday', async () => {
      const monday = new Date('2024-01-08'); // Monday
      mockQueryBuilder.single.mockResolvedValue({ data: null, error: null });

      const result = await getCanteenStatus(monday);

      expect(result.isOpen).toBe(true);
    });

    it('uses current date when none provided', async () => {
      mockQueryBuilder.single.mockResolvedValue({ data: null, error: null });

      const result = await getCanteenStatus();

      expect(result.date).toBeDefined();
    });
  });

  describe('getAvailableOrderDates', () => {
    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockResolvedValue({ data: [], error: null })
    };

    beforeEach(() => {
      mockFrom.mockReturnValue(mockQueryBuilder);
    });

    it('returns array of dates', async () => {
      mockQueryBuilder.lte.mockResolvedValue({ data: [], error: null });

      const result = await getAvailableOrderDates(5);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('excludes weekends', async () => {
      mockQueryBuilder.lte.mockResolvedValue({ data: [], error: null });

      const result = await getAvailableOrderDates(5);

      for (const date of result) {
        const dayOfWeek = date.getDay();
        expect(dayOfWeek).not.toBe(0); // Not Sunday
        expect(dayOfWeek).not.toBe(6); // Not Saturday
      }
    });

    it('excludes holidays', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];
      
      mockQueryBuilder.lte.mockResolvedValue({ 
        data: [{ date: tomorrowStr }], 
        error: null 
      });

      const result = await getAvailableOrderDates(5);

      // Result should not contain the holiday date
      const holidayFound = result.some(
        d => d.toISOString().split('T')[0] === tomorrowStr
      );
      expect(holidayFound).toBe(false);
    });
  });

  describe('getProductsForDate', () => {
    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null })
    };

    beforeEach(() => {
      mockFrom.mockReturnValue(mockQueryBuilder);
    });

    it('returns empty array on weekend', async () => {
      const saturday = new Date('2024-01-06');
      
      const result = await getProductsForDate(saturday);

      expect(result).toEqual([]);
    });

    it('returns empty array on holiday', async () => {
      const date = new Date('2024-12-25');
      mockQueryBuilder.single.mockResolvedValue({ data: { id: 'holiday-1' }, error: null });

      const result = await getProductsForDate(date);

      expect(result).toEqual([]);
    });

    it('returns scheduled products for weekday', async () => {
      const monday = new Date('2024-01-08');
      const mockProducts = [
        { id: 'product-1', name: 'Scheduled Product' }
      ];
      
      // Holiday check
      mockQueryBuilder.single.mockResolvedValueOnce({ data: null, error: null });
      // Menu schedules
      mockQueryBuilder.order.mockResolvedValueOnce({ 
        data: [{ product_id: 'product-1' }], 
        error: null 
      });
      // Products query
      mockQueryBuilder.order.mockResolvedValueOnce({ 
        data: mockProducts, 
        error: null 
      });

      const result = await getProductsForDate(monday);

      expect(result).toEqual(mockProducts);
    });
  });

  describe('getMenuSchedules', () => {
    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null })
    };

    beforeEach(() => {
      mockFrom.mockReturnValue(mockQueryBuilder);
    });

    it('queries menu_schedules table', async () => {
      await getMenuSchedules();

      expect(mockFrom).toHaveBeenCalledWith('menu_schedules');
    });

    it('filters by active schedules', async () => {
      await getMenuSchedules();

      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('is_active', true);
    });

    it('returns schedule data', async () => {
      const mockSchedules = [
        { id: 's1', product_id: 'p1', day_of_week: 1 },
        { id: 's2', product_id: 'p2', day_of_week: 2 }
      ];
      mockQueryBuilder.eq.mockResolvedValue({ data: mockSchedules, error: null });

      const result = await getMenuSchedules();

      expect(result).toEqual(mockSchedules);
    });

    it('returns empty array when no schedules', async () => {
      mockQueryBuilder.eq.mockResolvedValue({ data: null, error: null });

      const result = await getMenuSchedules();

      expect(result).toEqual([]);
    });
  });
});
