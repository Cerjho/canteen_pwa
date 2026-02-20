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

import { createOrder, getOrderHistory } from '../../../src/services/orders';
import { isOnline, queueOrder } from '../../../src/services/localQueue';

describe('Orders Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isOnline as ReturnType<typeof vi.fn>).mockReturnValue(true);
    // Provide a valid session so createOrder doesn't throw "Please sign in"
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' }, access_token: 'tok', expires_at: Math.floor(Date.now() / 1000) + 3600 } },
      error: null
    });
    mockRefreshSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' }, access_token: 'tok-new' } },
      error: null
    });
  });

  describe('createOrder', () => {
    const mockOrderData = {
      parent_id: 'parent-123',
      student_id: 'child-1',
      client_order_id: 'client-order-1',
      items: [
        { product_id: 'product-1', quantity: 2, price_at_order: 65.00 }
      ],
      payment_method: 'cash',
      notes: 'No spicy'
    };

    it('calls process-order function when online', async () => {
      mockInvoke.mockResolvedValue({ data: { id: 'order-1' }, error: null });

      await createOrder(mockOrderData);

      expect(mockInvoke).toHaveBeenCalledWith('process-order', {
        body: mockOrderData
      });
    });

    it('returns order data on success', async () => {
      mockInvoke.mockResolvedValue({ data: { id: 'order-1', status: 'pending' }, error: null });

      const result = await createOrder(mockOrderData);

      expect(result).toEqual({ id: 'order-1', status: 'pending' });
    });

    it('throws error on failure', async () => {
      const errorObj = { message: 'Insufficient balance' };
      mockInvoke.mockResolvedValue({ data: null, error: errorObj });

      // The service catches errors and converts them to Error instances
      await expect(createOrder(mockOrderData)).rejects.toBeInstanceOf(Error);
    });

    it('queues order when offline', async () => {
      (isOnline as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const result = await createOrder(mockOrderData);

      expect(queueOrder).toHaveBeenCalledWith(mockOrderData);
      expect(result).toEqual({ queued: true });
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('includes scheduled_for in order data', async () => {
      mockInvoke.mockResolvedValue({ data: { id: 'order-1' }, error: null });

      const orderWithSchedule = {
        ...mockOrderData,
        scheduled_for: '2024-01-15'
      };

      await createOrder(orderWithSchedule);

      expect(mockInvoke).toHaveBeenCalledWith('process-order', {
        body: orderWithSchedule
      });
    });
  });

  describe('getOrderHistory', () => {
    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null })
    };

    beforeEach(() => {
      mockFrom.mockReturnValue(mockQueryBuilder);
    });

    it('queries orders table', async () => {
      mockQueryBuilder.limit.mockResolvedValue({ data: [], error: null });

      await getOrderHistory('parent-123');

      expect(mockFrom).toHaveBeenCalledWith('orders');
    });

    it('selects order with related data', async () => {
      mockQueryBuilder.limit.mockResolvedValue({ data: [], error: null });

      await getOrderHistory('parent-123');

      expect(mockQueryBuilder.select).toHaveBeenCalledWith(expect.stringContaining('child:students'));
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(expect.stringContaining('items:order_items'));
    });

    it('filters by parent_id', async () => {
      mockQueryBuilder.limit.mockResolvedValue({ data: [], error: null });

      await getOrderHistory('parent-123');

      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('parent_id', 'parent-123');
    });

    it('orders by created_at descending', async () => {
      mockQueryBuilder.limit.mockResolvedValue({ data: [], error: null });

      await getOrderHistory('parent-123');

      expect(mockQueryBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    });

    it('limits results to 50', async () => {
      mockQueryBuilder.limit.mockResolvedValue({ data: [], error: null });

      await getOrderHistory('parent-123');

      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(50);
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
      mockQueryBuilder.limit.mockResolvedValue({ data: mockOrders, error: null });

      const result = await getOrderHistory('parent-123');

      expect(result).toEqual(mockOrders);
    });

    it('throws error on failure', async () => {
      mockQueryBuilder.limit.mockResolvedValue({ data: null, error: { message: 'Database error' } });

      await expect(getOrderHistory('parent-123')).rejects.toEqual({ message: 'Database error' });
    });
  });
});
