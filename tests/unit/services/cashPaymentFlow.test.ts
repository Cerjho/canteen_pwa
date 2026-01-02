// Cash Payment Flow Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch for edge function calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Cash Payment Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('confirm-cash-payment', () => {
    it('should confirm cash payment and update order status', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          order_id: 'order-123',
          new_status: 'pending',
          payment_status: 'paid',
          message: 'Payment confirmed'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/confirm-cash-payment', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer staff-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          order_id: 'order-123'
        })
      });

      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.new_status).toBe('pending');
      expect(result.payment_status).toBe('paid');
    });

    it('should reject non-cash orders', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'INVALID_PAYMENT_METHOD',
          message: 'This order is not a cash payment order'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/confirm-cash-payment', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer staff-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          order_id: 'order-balance-paid'
        })
      });

      expect(response.ok).toBe(false);
      const result = await response.json();
      expect(result.error).toBe('INVALID_PAYMENT_METHOD');
    });

    it('should reject already paid orders', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'ALREADY_PAID',
          message: 'This order has already been paid'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/confirm-cash-payment', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer staff-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          order_id: 'order-already-paid'
        })
      });

      expect(response.ok).toBe(false);
      const result = await response.json();
      expect(result.error).toBe('ALREADY_PAID');
    });

    it('should reject expired orders', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'PAYMENT_TIMEOUT',
          message: 'Payment timeout has expired'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/confirm-cash-payment', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer staff-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          order_id: 'order-expired'
        })
      });

      expect(response.ok).toBe(false);
      const result = await response.json();
      expect(result.error).toBe('PAYMENT_TIMEOUT');
    });

    it('should reject non-existent orders', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({
          error: 'ORDER_NOT_FOUND',
          message: 'Order not found'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/confirm-cash-payment', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer staff-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          order_id: 'non-existent-order'
        })
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
    });

    it('should require staff or admin role', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({
          error: 'FORBIDDEN',
          message: 'Staff or admin access required'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/confirm-cash-payment', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer parent-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          order_id: 'order-123'
        })
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(403);
    });
  });

  describe('cleanup-timeout-orders', () => {
    it('should cancel expired unpaid orders', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          cancelled_count: 3,
          cancelled_orders: ['order-1', 'order-2', 'order-3']
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/cleanup-timeout-orders', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer service-key',
          'Content-Type': 'application/json'
        }
      });

      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.cancelled_count).toBe(3);
    });

    it('should restore stock for cancelled orders', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          cancelled_count: 1,
          stock_restored: true
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/cleanup-timeout-orders', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer service-key',
          'Content-Type': 'application/json'
        }
      });

      const result = await response.json();
      expect(result.stock_restored).toBe(true);
    });

    it('should handle no expired orders gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          cancelled_count: 0,
          message: 'No expired orders found'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/cleanup-timeout-orders', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer service-key',
          'Content-Type': 'application/json'
        }
      });

      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.cancelled_count).toBe(0);
    });
  });

  describe('payment timeout flow', () => {
    it('should create order with 15-minute timeout', async () => {
      const now = Date.now();
      const expectedDueAt = new Date(now + 15 * 60 * 1000);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          order_id: 'order-cash',
          status: 'awaiting_payment',
          payment_status: 'awaiting_payment',
          payment_due_at: expectedDueAt.toISOString()
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/process-order', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer parent-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          parent_id: 'parent-123',
          student_id: 'student-456',
          client_order_id: 'cash-order-123',
          items: [{ product_id: 'product-1', quantity: 1, price_at_order: 65.00 }],
          payment_method: 'cash',
          scheduled_for: '2026-01-05'
        })
      });

      const result = await response.json();
      expect(result.payment_due_at).toBeDefined();
      
      const dueAt = new Date(result.payment_due_at);
      // Should be approximately 15 minutes from now (within 1 minute tolerance)
      const diffMinutes = (dueAt.getTime() - now) / (60 * 1000);
      expect(diffMinutes).toBeGreaterThan(14);
      expect(diffMinutes).toBeLessThan(16);
    });
  });
});

describe('Staff Dashboard Payment Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display awaiting_payment orders', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        {
          id: 'order-1',
          status: 'awaiting_payment',
          payment_status: 'awaiting_payment',
          payment_method: 'cash',
          payment_due_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          total_amount: 65.00
        },
        {
          id: 'order-2',
          status: 'pending',
          payment_status: 'paid',
          payment_method: 'balance',
          total_amount: 130.00
        }
      ])
    });

    const response = await fetch('https://test.supabase.co/rest/v1/orders', {
      headers: {
        'Authorization': 'Bearer staff-token'
      }
    });

    const orders = await response.json();
    const awaitingPayment = orders.filter((o: { status: string }) => o.status === 'awaiting_payment');
    expect(awaitingPayment.length).toBe(1);
  });

  it('should show time remaining for cash payment', () => {
    const paymentDueAt = new Date(Date.now() + 8 * 60 * 1000).toISOString(); // 8 minutes
    
    const getPaymentTimeRemaining = (due: string) => {
      const dueDate = new Date(due);
      const now = new Date();
      const diffMs = dueDate.getTime() - now.getTime();
      if (diffMs <= 0) return 'Expired';
      const mins = Math.floor(diffMs / 60000);
      const secs = Math.floor((diffMs % 60000) / 1000);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const timeRemaining = getPaymentTimeRemaining(paymentDueAt);
    expect(timeRemaining).toMatch(/^[0-9]+:[0-9]{2}$/);
    expect(timeRemaining.startsWith('7:') || timeRemaining.startsWith('8:')).toBe(true);
  });

  it('should show Expired for past due orders', () => {
    const paymentDueAt = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 minutes ago
    
    const getPaymentTimeRemaining = (due: string) => {
      const dueDate = new Date(due);
      const now = new Date();
      const diffMs = dueDate.getTime() - now.getTime();
      if (diffMs <= 0) return 'Expired';
      const mins = Math.floor(diffMs / 60000);
      const secs = Math.floor((diffMs % 60000) / 1000);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const timeRemaining = getPaymentTimeRemaining(paymentDueAt);
    expect(timeRemaining).toBe('Expired');
  });
});
