// LocalQueue Service Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock idb
const mockDB = {
  add: vi.fn(),
  get: vi.fn(),
  getAll: vi.fn(),
  put: vi.fn(),
  delete: vi.fn()
};

vi.mock('idb', () => ({
  openDB: vi.fn(() => Promise.resolve(mockDB))
}));

// We need to reset the module to get fresh state
let localQueueModule: typeof import('../../../src/services/localQueue');

describe('LocalQueue Service', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    
    // Re-import the module to get fresh state
    localQueueModule = await import('../../../src/services/localQueue');
    
    // Reset navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true
    });
  });

  describe('isOnline', () => {
    it('returns true when navigator.onLine is true', () => {
      Object.defineProperty(navigator, 'onLine', { value: true });
      
      expect(localQueueModule.isOnline()).toBe(true);
    });

    it('returns false when navigator.onLine is false', () => {
      Object.defineProperty(navigator, 'onLine', { value: false });
      
      expect(localQueueModule.isOnline()).toBe(false);
    });
  });

  describe('queueOrder', () => {
    const mockOrderData = {
      parent_id: 'parent-123',
      student_id: 'child-1',
      client_order_id: 'client-order-1',
      items: [{ product_id: 'product-1', quantity: 1, price_at_order: 65 }],
      payment_method: 'cash',
      notes: 'Test order'
    };

    it('adds order to database with generated fields', async () => {
      mockDB.add.mockResolvedValue(undefined);

      await localQueueModule.queueOrder(mockOrderData);

      expect(mockDB.add).toHaveBeenCalledWith('order-queue', expect.objectContaining({
        ...mockOrderData,
        id: expect.any(String),
        queued_at: expect.any(Date),
        retry_count: 0
      }));
    });

    it('generates unique id for each order', async () => {
      mockDB.add.mockResolvedValue(undefined);

      await localQueueModule.queueOrder(mockOrderData);
      const firstCall = mockDB.add.mock.calls[0][1];

      mockDB.add.mockClear();
      await localQueueModule.queueOrder(mockOrderData);
      const secondCall = mockDB.add.mock.calls[0][1];

      expect(firstCall.id).not.toBe(secondCall.id);
    });

    it('sets initial retry_count to 0', async () => {
      mockDB.add.mockResolvedValue(undefined);

      await localQueueModule.queueOrder(mockOrderData);

      expect(mockDB.add).toHaveBeenCalledWith('order-queue', expect.objectContaining({
        retry_count: 0
      }));
    });
  });

  describe('getQueuedOrders', () => {
    it('retrieves all orders from queue', async () => {
      const mockOrders = [
        { id: '1', parent_id: 'p1', retry_count: 0 },
        { id: '2', parent_id: 'p2', retry_count: 1 }
      ];
      mockDB.getAll.mockResolvedValue(mockOrders);

      const result = await localQueueModule.getQueuedOrders();

      expect(mockDB.getAll).toHaveBeenCalledWith('order-queue');
      expect(result).toEqual(mockOrders);
    });

    it('returns empty array when no orders', async () => {
      mockDB.getAll.mockResolvedValue([]);

      const result = await localQueueModule.getQueuedOrders();

      expect(result).toEqual([]);
    });
  });

  describe('removeQueuedOrder', () => {
    it('removes order by id', async () => {
      mockDB.delete.mockResolvedValue(undefined);

      await localQueueModule.removeQueuedOrder('order-123');

      expect(mockDB.delete).toHaveBeenCalledWith('order-queue', 'order-123');
    });
  });

  describe('incrementRetryCount', () => {
    it('increments retry count for existing order', async () => {
      const existingOrder = { id: 'order-123', retry_count: 2 };
      mockDB.get.mockResolvedValue(existingOrder);
      mockDB.put.mockResolvedValue(undefined);

      await localQueueModule.incrementRetryCount('order-123');

      expect(mockDB.get).toHaveBeenCalledWith('order-queue', 'order-123');
      expect(mockDB.put).toHaveBeenCalledWith('order-queue', {
        id: 'order-123',
        retry_count: 3
      });
    });

    it('does nothing for non-existent order', async () => {
      mockDB.get.mockResolvedValue(undefined);

      await localQueueModule.incrementRetryCount('non-existent');

      expect(mockDB.put).not.toHaveBeenCalled();
    });
  });

  describe('updateOrderError', () => {
    it('updates last_error for existing order', async () => {
      const existingOrder = { id: 'order-123', retry_count: 1 };
      mockDB.get.mockResolvedValue(existingOrder);
      mockDB.put.mockResolvedValue(undefined);

      await localQueueModule.updateOrderError('order-123', 'Network timeout');

      expect(mockDB.get).toHaveBeenCalledWith('order-queue', 'order-123');
      expect(mockDB.put).toHaveBeenCalledWith('order-queue', {
        id: 'order-123',
        retry_count: 1,
        last_error: 'Network timeout'
      });
    });

    it('does nothing for non-existent order', async () => {
      mockDB.get.mockResolvedValue(undefined);

      await localQueueModule.updateOrderError('non-existent', 'Error');

      expect(mockDB.put).not.toHaveBeenCalled();
    });
  });

  describe('processQueue', () => {
    beforeEach(() => {
      // Mock supabase for processQueue
      vi.doMock('../../../src/services/supabaseClient', () => ({
        supabase: {
          auth: {
            getSession: vi.fn().mockResolvedValue({
              data: { 
                session: { 
                  user: { id: 'user-123' },
                  access_token: 'token'
                } 
              }
            })
          },
          functions: {
            invoke: vi.fn().mockResolvedValue({ data: { id: 'order-1' }, error: null })
          }
        }
      }));
    });

    it('returns zeros when offline', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false });

      const result = await localQueueModule.processQueue();

      expect(result).toEqual({ processed: 0, failed: 0 });
    });

    it('returns zeros when queue is empty', async () => {
      mockDB.getAll.mockResolvedValue([]);

      const result = await localQueueModule.processQueue();

      expect(result.processed).toBe(0);
      expect(result.failed).toBe(0);
    });
  });
});
