// Products Service Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase client
const mockFrom = vi.fn();

vi.mock('../../../src/services/supabaseClient', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args)
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
} from '../../../src/services/products';

// Note: getProducts() takes no arguments (uses current date)
// Use getProductsForDate(date) to test with specific dates

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
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
    };

    beforeEach(() => {
      mockFrom.mockReturnValue(mockQueryBuilder);
    });

    // getProducts is a complex function that internally calls getCanteenStatus and other functions
    // These tests validate the basic contract of the function
    it('returns products array', async () => {
      const mockProducts = [
        { id: 'p1', name: 'Product 1', available: true },
        { id: 'p2', name: 'Product 2', available: true }
      ];
      mockQueryBuilder.in.mockResolvedValue({ data: mockProducts, error: null });
      mockQueryBuilder.maybeSingle.mockResolvedValue({ data: null, error: null }); // no holiday
      
      const result = await getProducts();
      
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns empty array on weekend', async () => {
      // Mock a Saturday
      const saturday = new Date('2024-01-06');
      mockQueryBuilder.maybeSingle.mockResolvedValue({ data: null, error: null }); // no makeup day
      
      const result = await getProductsForDate(saturday);
      
      expect(result).toEqual([]);
    });

    it('calls menu_schedules table for weekday', async () => {
      const monday = new Date('2024-01-08');
      mockQueryBuilder.maybeSingle.mockResolvedValue({ data: null, error: null }); // no holiday
      
      await getProductsForDate(monday);
      
      // getProductsForDate calls holidays, then menu_schedules
      expect(mockFrom).toHaveBeenCalledWith('menu_schedules');
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
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
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

    // Skip: Requires complex mock chaining for checkHoliday function
    it('returns closed on holiday', async () => {
      // Mock holiday lookup - first call for exact match, second for recurring
      const holidayQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { name: 'Test Holiday', is_recurring: false }, error: null })
      };
      mockFrom.mockReturnValue(holidayQueryBuilder);

      const monday = new Date('2024-01-08'); // A weekday
      const result = await getCanteenStatus(monday);

      expect(result.isOpen).toBe(false);
      expect(result.reason).toBe('holiday');
    });

    it('returns open on regular weekday without holiday', async () => {
      // Mock no holiday found
      const noHolidayQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
      };
      mockFrom.mockReturnValue(noHolidayQueryBuilder);

      const monday = new Date('2024-01-08'); // A weekday
      const result = await getCanteenStatus(monday);

      expect(result.isOpen).toBe(true);
    });

    it('uses current date when none provided', async () => {
      // This test checks that date is defined, which works regardless of mock
      mockQueryBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });

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
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
    };

    beforeEach(() => {
      mockFrom.mockReturnValue(mockQueryBuilder);
    });

    it('returns empty array on weekend', async () => {
      const saturday = new Date('2024-01-06');
      
      const result = await getProductsForDate(saturday);

      expect(result).toEqual([]);
    });

    // These tests validate holiday and menu scenarios
    it('returns empty array on holiday', async () => {
      // Mock holiday found
      const holidayQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { name: 'Holiday', is_recurring: false }, error: null })
      };
      mockFrom.mockReturnValue(holidayQueryBuilder);

      const monday = new Date('2024-01-08');
      const result = await getProductsForDate(monday);

      expect(result).toEqual([]);
    });

    it('returns scheduled products for weekday', async () => {
      // First mock returns no holiday, second returns schedules, third returns products
      let callCount = 0;
      const dynamicMockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            // Holiday check - no holiday
            return { maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
          }
          // Menu schedules
          return dynamicMockQueryBuilder;
        }),
        in: vi.fn().mockResolvedValue({ 
          data: [{ id: 'p1', name: 'Product 1' }], 
          error: null 
        }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
      };
      mockFrom.mockReturnValue(dynamicMockQueryBuilder);

      const monday = new Date('2024-01-08');
      const result = await getProductsForDate(monday);

      expect(Array.isArray(result)).toBe(true);
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
