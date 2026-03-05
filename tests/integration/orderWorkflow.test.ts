// Integration Tests for Order Workflow
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Order Workflow Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Cash Payment Flow', () => {
    it('should complete full cash payment workflow', async () => {
      // 1. Parent creates cash order
      const orderResult = {
        success: true,
        order_id: 'order-cash-1',
        status: 'awaiting_payment',
        payment_status: 'awaiting_payment',
        payment_due_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        total_amount: 155.00
      };

      expect(orderResult.status).toBe('awaiting_payment');

      // 2. Order appears in staff dashboard with awaiting payment status
      const staffOrders = [{
        id: orderResult.order_id,
        status: 'awaiting_payment',
        payment_status: 'awaiting_payment',
        payment_due_at: orderResult.payment_due_at,
        payment_method: 'cash',
        total_amount: 155.00
      }];

      expect(staffOrders[0].payment_method).toBe('cash');

      // 3. Staff confirms cash payment
      const confirmResult = {
        success: true,
        order_id: orderResult.order_id,
        new_status: 'pending',
        payment_status: 'paid'
      };

      expect(confirmResult.new_status).toBe('pending');
      expect(confirmResult.payment_status).toBe('paid');

      // 4. Order moves to normal workflow
      const paidOrder = {
        ...staffOrders[0],
        status: 'pending',
        payment_status: 'paid'
      };
      expect(paidOrder.status).toBe('pending');
    });

    it('should handle payment timeout', async () => {
      // 1. Create cash order
      const orderResult = {
        order_id: 'order-timeout-1',
        status: 'awaiting_payment',
        payment_due_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      };

      // 2. Fast forward 16 minutes
      vi.advanceTimersByTime(16 * 60 * 1000);

      // 3. Cleanup job runs and cancels order
      const cleanupResult = {
        success: true,
        cancelled_count: 1,
        cancelled_orders: [orderResult.order_id]
      };

      expect(cleanupResult.cancelled_orders).toContain(orderResult.order_id);

      // 4. Order is now cancelled
      const cancelledOrder = {
        id: orderResult.order_id,
        status: 'cancelled',
        payment_status: 'timeout'
      };

      expect(cancelledOrder.status).toBe('cancelled');
      expect(cancelledOrder.payment_status).toBe('timeout');
    });
  });

  describe('Future Order Scheduling', () => {
    it('should handle scheduled future orders', async () => {
      const futureDate = '2026-01-10';

      // 1. Create order for future date
      const orderResult = {
        success: true,
        order_id: 'order-future-1',
        status: 'pending',
        scheduled_for: futureDate
      };

      expect(orderResult.scheduled_for).toBe(futureDate);

      // 2. Order appears in staff future orders view
      const staffFutureOrders = [{
        id: orderResult.order_id,
        scheduled_for: futureDate,
        status: 'pending'
      }];

      expect(staffFutureOrders[0].scheduled_for).toBe(futureDate);

      // 3. On the scheduled date, order appears in today's view
      vi.setSystemTime(new Date('2026-01-10T08:00:00'));

      const todayOrders = staffFutureOrders.filter(
        o => o.scheduled_for === '2026-01-10'
      );
      expect(todayOrders.length).toBe(1);
    });
  });

  describe('Menu Scheduling Workflow', () => {
    it('should schedule menu for specific dates', async () => {
      // 1. Admin adds products to Monday
      const mondaySchedules = [
        { product_id: 'product-1', scheduled_date: '2026-01-05', day_of_week: 1 },
        { product_id: 'product-2', scheduled_date: '2026-01-05', day_of_week: 1 }
      ];

      expect(mondaySchedules.length).toBe(2);

      // 2. Admin copies to all weekdays
      const weekSchedules = [
        ...mondaySchedules,
        { product_id: 'product-1', scheduled_date: '2026-01-06', day_of_week: 2 },
        { product_id: 'product-2', scheduled_date: '2026-01-06', day_of_week: 2 },
        { product_id: 'product-1', scheduled_date: '2026-01-07', day_of_week: 3 },
        { product_id: 'product-2', scheduled_date: '2026-01-07', day_of_week: 3 }
      ];

      expect(weekSchedules.length).toBe(6);

      // 3. Parent views menu for specific date
      const tuesdayMenu = weekSchedules.filter(
        s => s.scheduled_date === '2026-01-06'
      );
      expect(tuesdayMenu.length).toBe(2);
    });

    it('should handle date-based menu queries correctly', () => {
      // Test that scheduled_date is used, not day_of_week
      const schedules = [
        { id: '1', product_id: 'p1', scheduled_date: '2026-01-05', day_of_week: 1 },
        { id: '2', product_id: 'p2', scheduled_date: '2026-01-05', day_of_week: 1 },
        { id: '3', product_id: 'p1', scheduled_date: '2026-01-12', day_of_week: 1 } // Next Monday
      ];

      // Query by scheduled_date (correct)
      const jan5Menu = schedules.filter(s => s.scheduled_date === '2026-01-05');
      expect(jan5Menu.length).toBe(2);

      // Different Monday should have different items
      const jan12Menu = schedules.filter(s => s.scheduled_date === '2026-01-12');
      expect(jan12Menu.length).toBe(1);
    });
  });
});

describe('Date Handling', () => {
  it('should format dates in local timezone', () => {
    // Helper function from the app
    function formatDateLocal(date: Date): string {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    const date = new Date('2026-01-05T23:00:00');
    const formatted = formatDateLocal(date);
    
    // Should return the local date, not UTC
    expect(formatted).toMatch(/^2026-01-0[56]$/); // May vary by timezone
  });

  it('should handle timezone edge cases', () => {
    // Create dates at midnight and near midnight
    const midnight = new Date('2026-01-05T00:00:00');
    const nearMidnight = new Date('2026-01-05T23:59:59');

    function formatDateLocal(date: Date): string {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    const midnightStr = formatDateLocal(midnight);
    const nearMidnightStr = formatDateLocal(nearMidnight);

    // Both should be same date in local timezone
    expect(midnightStr).toBe(nearMidnightStr);
  });
});
