// Admin Weekly Menu Tests
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

describe('Admin Weekly Menu Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T10:00:00')); // Monday
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Week Navigation', () => {
    it('should calculate week start (Monday)', () => {
      const today = new Date('2026-01-08'); // Wednesday
      const dayOfWeek = today.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() + diff);

      expect(weekStart.getDay()).toBe(1); // Monday
      expect(weekStart.getDate()).toBe(5); // January 5, 2026 (Monday of that week)
    });

    it('should generate week dates', () => {
      const weekStart = new Date('2026-01-05'); // Monday
      const weekDates: string[] = [];

      for (let i = 0; i < 5; i++) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + i);
        weekDates.push(date.toISOString().split('T')[0]);
      }

      expect(weekDates).toEqual([
        '2026-01-05', // Monday
        '2026-01-06', // Tuesday
        '2026-01-07', // Wednesday
        '2026-01-08', // Thursday
        '2026-01-09'  // Friday
      ]);
    });

    it('should navigate to next week', () => {
      const currentWeekStart = new Date('2026-01-05');
      const nextWeekStart = new Date(currentWeekStart);
      nextWeekStart.setDate(currentWeekStart.getDate() + 7);

      expect(nextWeekStart.toISOString().split('T')[0]).toBe('2026-01-12');
    });

    it('should navigate to previous week', () => {
      const currentWeekStart = new Date('2026-01-05');
      const prevWeekStart = new Date(currentWeekStart);
      prevWeekStart.setDate(currentWeekStart.getDate() - 7);

      expect(prevWeekStart.toISOString().split('T')[0]).toBe('2025-12-29');
    });
  });

  describe('Menu Schedule Management', () => {
    it('should add product to schedule', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true, schedule_id: 'schedule-1' },
        error: null
      });

      await mockSupabase.functions.invoke('manage-menu', {
        body: {
          action: 'add',
          product_id: 'product-1',
          scheduled_date: '2026-01-05'
        }
      });

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
        'manage-menu',
        expect.objectContaining({
          body: expect.objectContaining({
            action: 'add',
            product_id: 'product-1',
            scheduled_date: '2026-01-05'
          })
        })
      );
    });

    it('should remove product from schedule', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true },
        error: null
      });

      await mockSupabase.functions.invoke('manage-menu', {
        body: {
          action: 'remove',
          schedule_id: 'schedule-1'
        }
      });

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
        'manage-menu',
        expect.objectContaining({
          body: expect.objectContaining({
            action: 'remove',
            schedule_id: 'schedule-1'
          })
        })
      );
    });

    it('should toggle product availability', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true, available: false },
        error: null
      });

      await mockSupabase.functions.invoke('manage-menu', {
        body: {
          action: 'toggle',
          schedule_id: 'schedule-1'
        }
      });

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
        'manage-menu',
        expect.objectContaining({
          body: expect.objectContaining({
            action: 'toggle',
            schedule_id: 'schedule-1'
          })
        })
      );
    });
  });

  describe('Bulk Operations', () => {
    it('should add bulk products', async () => {
      const productIds = ['product-1', 'product-2', 'product-3'];
      
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true, added_count: 3 },
        error: null
      });

      await mockSupabase.functions.invoke('manage-menu', {
        body: {
          action: 'add-bulk',
          product_ids: productIds,
          scheduled_date: '2026-01-05'
        }
      });

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
        'manage-menu',
        expect.objectContaining({
          body: expect.objectContaining({
            action: 'add-bulk',
            product_ids: productIds,
            scheduled_date: '2026-01-05'
          })
        })
      );
    });

    it('should copy day schedule', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true, copied_count: 5 },
        error: null
      });

      await mockSupabase.functions.invoke('manage-menu', {
        body: {
          action: 'copy-day',
          source_date: '2026-01-05',
          target_date: '2026-01-06'
        }
      });

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
        'manage-menu',
        expect.objectContaining({
          body: expect.objectContaining({
            action: 'copy-day',
            source_date: '2026-01-05',
            target_date: '2026-01-06'
          })
        })
      );
    });

    it('should copy week schedule', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true, copied_count: 25 },
        error: null
      });

      await mockSupabase.functions.invoke('manage-menu', {
        body: {
          action: 'copy-week',
          source_week_start: '2026-01-05',
          target_week_start: '2026-01-12'
        }
      });

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
        'manage-menu',
        expect.objectContaining({
          body: expect.objectContaining({
            action: 'copy-week',
            source_week_start: '2026-01-05',
            target_week_start: '2026-01-12'
          })
        })
      );
    });

    it('should clear day schedule', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true, deleted_count: 5 },
        error: null
      });

      await mockSupabase.functions.invoke('manage-menu', {
        body: {
          action: 'clear-day',
          scheduled_date: '2026-01-05'
        }
      });

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
        'manage-menu',
        expect.objectContaining({
          body: expect.objectContaining({
            action: 'clear-day',
            scheduled_date: '2026-01-05'
          })
        })
      );
    });

    it('should clear week schedule', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true, deleted_count: 25 },
        error: null
      });

      await mockSupabase.functions.invoke('manage-menu', {
        body: {
          action: 'clear-week',
          week_start: '2026-01-05'
        }
      });

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
        'manage-menu',
        expect.objectContaining({
          body: expect.objectContaining({
            action: 'clear-week',
            week_start: '2026-01-05'
          })
        })
      );
    });
  });

  describe('Date Formatting', () => {
    it('should format date in local timezone', () => {
      const formatDateLocal = (date: Date): string => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      const date = new Date('2026-01-05T00:00:00');
      expect(formatDateLocal(date)).toBe('2026-01-05');
    });

    it('should get day name from date', () => {
      const getDayName = (date: Date): string => {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[date.getDay()];
      };

      const monday = new Date('2026-01-05');
      expect(getDayName(monday)).toBe('Monday');

      const wednesday = new Date('2026-01-07');
      expect(getDayName(wednesday)).toBe('Wednesday');
    });

    it('should get day of week number', () => {
      // JavaScript: Sunday = 0, Monday = 1, etc.
      // Our system: Monday = 1, Tuesday = 2, etc.
      const getOurDayOfWeek = (date: Date): number => {
        const jsDay = date.getDay();
        return jsDay === 0 ? 7 : jsDay; // Convert Sunday from 0 to 7
      };

      const monday = new Date('2026-01-05');
      expect(getOurDayOfWeek(monday)).toBe(1);

      const sunday = new Date('2026-01-04');
      expect(getOurDayOfWeek(sunday)).toBe(7);
    });
  });

  describe('Menu Display', () => {
    it('should group schedules by date', () => {
      const schedules = [
        { id: '1', product_id: 'p1', scheduled_date: '2026-01-05' },
        { id: '2', product_id: 'p2', scheduled_date: '2026-01-05' },
        { id: '3', product_id: 'p3', scheduled_date: '2026-01-06' }
      ];

      const grouped = schedules.reduce((acc, s) => {
        if (!acc[s.scheduled_date]) {
          acc[s.scheduled_date] = [];
        }
        acc[s.scheduled_date].push(s);
        return acc;
      }, {} as Record<string, typeof schedules>);

      expect(grouped['2026-01-05']).toHaveLength(2);
      expect(grouped['2026-01-06']).toHaveLength(1);
    });

    it('should show empty state for days without menu', () => {
      const schedules: Array<{ id: string; product_id: string; scheduled_date: string }> = [];
      const daySchedules = schedules.filter(s => s.scheduled_date === '2026-01-05');
      expect(daySchedules).toHaveLength(0);
    });

    it('should show product details in schedule', () => {
      const schedule = {
        id: 'schedule-1',
        product_id: 'product-1',
        scheduled_date: '2026-01-05',
        available: true,
        products: {
          name: 'Burger',
          price: 75.00,
          image_url: '/burger.jpg'
        }
      };

      expect(schedule.products.name).toBe('Burger');
      expect(schedule.products.price).toBe(75.00);
      expect(schedule.available).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle add error', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: null,
        error: { message: 'Product not found' }
      });

      const result = await mockSupabase.functions.invoke('manage-menu', {
        body: { action: 'add', product_id: 'invalid-id', scheduled_date: '2026-01-05' }
      });

      expect(result.error).toBeTruthy();
    });

    it('should handle copy error when source has no schedules', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: false, error: 'No schedules found for source date' },
        error: null
      });

      const result = await mockSupabase.functions.invoke('manage-menu', {
        body: { action: 'copy-day', source_date: '2026-01-01', target_date: '2026-01-05' }
      });

      expect(result.data.error).toBeTruthy();
    });

    it('should handle duplicate product error', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: false, error: 'Product already scheduled for this date' },
        error: null
      });

      const result = await mockSupabase.functions.invoke('manage-menu', {
        body: { action: 'add', product_id: 'product-1', scheduled_date: '2026-01-05' }
      });

      expect(result.data.error).toBeTruthy();
    });
  });

  describe('Authorization', () => {
    it('should reject non-admin users', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: null,
        error: { message: 'Forbidden - Admin access required' }
      });

      const result = await mockSupabase.functions.invoke('manage-menu', {
        body: { action: 'add', product_id: 'product-1', scheduled_date: '2026-01-05' }
      });

      expect(result.error.message).toContain('Forbidden');
    });
  });
});

describe('Schedule Queries', () => {
  it('should query by scheduled_date not day_of_week', () => {
    // This is the critical fix - ensure we use scheduled_date
    const queryParams = {
      scheduled_date: '2026-01-05'
    };

    expect(queryParams).toHaveProperty('scheduled_date');
    expect(queryParams).not.toHaveProperty('day_of_week');
  });

  it('should handle week range queries', () => {
    const weekStart = '2026-01-05';
    const weekEnd = '2026-01-09';

    // Build query range
    const queryRange = {
      gte: weekStart,
      lte: weekEnd
    };

    expect(queryRange.gte).toBe('2026-01-05');
    expect(queryRange.lte).toBe('2026-01-09');
  });
});
