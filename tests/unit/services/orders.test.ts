// Orders Service Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase client
const mockInvoke = vi.fn();
const _mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockGetSession = vi.fn();
const mockRefreshSession = vi.fn();

vi.mock('../../../src/services/supabaseClient', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args)
    },
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {
      getSession: () => mockGetSession(),
      refreshSession: () => mockRefreshSession()
    }
  }
}));

// Mock localQueue
vi.mock('../../../src/services/localQueue', () => ({
  isOnline: vi.fn(() => true),
  queueOrder: vi.fn()
}));

import { createWeeklyOrder, getOrderHistory } from '../../../src/services/orders';
import { isOnline, queueOrder } from '../../../src/services/localQueue';

describe('Orders Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isOnline as ReturnType<typeof vi.fn>).mockReturnValue(true);
    // Provide a valid session so createWeeklyOrder doesn't throw "Please sign in"
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' }, access_token: 'tok', expires_at: Math.floor(Date.now() / 1000) + 3600 } },
      error: null
    });
    mockRefreshSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' }, access_token: 'tok-new' } },
      error: null
    });
  });

  describe('createWeeklyOrder', () => {
    const mockWeeklyOrderData = {
      parent_id: 'parent-123',
      student_id: 'student-1',
      week_start: '2026-03-09',
      days: [
        {
          scheduled_for: '2026-03-09',
          items: [{ product_id: 'product-1', quantity: 2, price_at_order: 65.00 }]
        }
      ],
      payment_method: 'cash' as const,
      notes: 'No spicy'
    };

    it('calls process-weekly-order function when online', async () => {
      const mockResponse = { success: true, weekly_order_id: 'wo-1', order_ids: ['o-1'], total_amount: 130, payment_status: 'paid', message: 'OK' };
      mockInvoke.mockResolvedValue({ data: mockResponse, error: null });

      await createWeeklyOrder(mockWeeklyOrderData);

      expect(mockInvoke).toHaveBeenCalledWith('process-weekly-order', {
        body: mockWeeklyOrderData
      });
    });

    it('returns weekly order response on success', async () => {
      const mockResponse = { success: true, weekly_order_id: 'wo-1', order_ids: ['o-1'], total_amount: 130, payment_status: 'paid', message: 'OK' };
      mockInvoke.mockResolvedValue({ data: mockResponse, error: null });

      const result = await createWeeklyOrder(mockWeeklyOrderData);

      expect(result).toEqual(mockResponse);
    });

    it('throws error on failure', async () => {
      const errorObj = { message: 'Order creation failed' };
      mockInvoke.mockResolvedValue({ data: null, error: errorObj });

      await expect(createWeeklyOrder(mockWeeklyOrderData)).rejects.toBeInstanceOf(Error);
    });

    it('queues order when offline (cash)', async () => {
      (isOnline as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const result = await createWeeklyOrder(mockWeeklyOrderData);

      expect(queueOrder).toHaveBeenCalled();
      expect(result.message).toContain('offline');
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('includes all days in weekly order request', async () => {
      const mockResponse = { success: true, weekly_order_id: 'wo-1', order_ids: ['o-1', 'o-2'], total_amount: 260, payment_status: 'paid', message: 'OK' };
      mockInvoke.mockResolvedValue({ data: mockResponse, error: null });

      const multiDayOrder = {
        ...mockWeeklyOrderData,
        days: [
          { scheduled_for: '2026-03-09', items: [{ product_id: 'p-1', quantity: 1, price_at_order: 65.00 }] },
          { scheduled_for: '2026-03-10', items: [{ product_id: 'p-2', quantity: 1, price_at_order: 65.00 }] },
        ]
      };

      await createWeeklyOrder(multiDayOrder);

      expect(mockInvoke).toHaveBeenCalledWith('process-weekly-order', {
        body: multiDayOrder
      });
    });
  });

  describe('getOrderHistory', () => {
    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null })
    };

    beforeEach(() => {
      mockFrom.mockReturnValue(mockQueryBuilder);
    });

    it('queries orders table', async () => {
      mockQueryBuilder.range.mockResolvedValue({ data: [], error: null });

      await getOrderHistory('parent-123');

      expect(mockFrom).toHaveBeenCalledWith('orders');
    });

    it('selects order with related data', async () => {
      mockQueryBuilder.range.mockResolvedValue({ data: [], error: null });

      await getOrderHistory('parent-123');

      expect(mockQueryBuilder.select).toHaveBeenCalledWith(expect.stringContaining('student:students'));
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(expect.stringContaining('items:order_items'));
    });

    it('filters by parent_id', async () => {
      mockQueryBuilder.range.mockResolvedValue({ data: [], error: null });

      await getOrderHistory('parent-123');

      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('parent_id', 'parent-123');
    });

    it('orders by created_at descending', async () => {
      mockQueryBuilder.range.mockResolvedValue({ data: [], error: null });

      await getOrderHistory('parent-123');

      expect(mockQueryBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    });

    it('paginates results with range(0, 19) by default', async () => {
      mockQueryBuilder.range.mockResolvedValue({ data: [], error: null });

      await getOrderHistory('parent-123');

      expect(mockQueryBuilder.range).toHaveBeenCalledWith(0, 19);
    });

    it('paginates with correct offset for page 1', async () => {
      mockQueryBuilder.range.mockResolvedValue({ data: [], error: null });

      await getOrderHistory('parent-123', 1);

      expect(mockQueryBuilder.range).toHaveBeenCalledWith(20, 39);
    });

    it('returns order data', async () => {
      const mockOrders = [
        {
          id: 'order-1',
          status: 'pending',
          child: { first_name: 'Maria', last_name: 'Santos' },
          items: []
        }
      ];
      mockQueryBuilder.range.mockResolvedValue({ data: mockOrders, error: null });

      const result = await getOrderHistory('parent-123');

      expect(result).toEqual(mockOrders);
    });

    it('throws error on failure', async () => {
      mockQueryBuilder.range.mockResolvedValue({ data: null, error: { message: 'Database error' } });

      await expect(getOrderHistory('parent-123')).rejects.toEqual({ message: 'Database error' });
    });
  });
});
