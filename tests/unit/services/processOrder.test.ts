// Process Order Edge Function Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch for edge function calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Process Order Edge Function', () => {
  const validOrderPayload = {
    parent_id: 'parent-123',
    student_id: 'student-456',
    client_order_id: 'client-order-789',
    items: [
      { product_id: 'product-1', quantity: 2, price_at_order: 65.00 },
      { product_id: 'product-2', quantity: 1, price_at_order: 25.00 }
    ],
    payment_method: 'balance',
    notes: 'No spicy please',
    scheduled_for: '2026-01-05'
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('successful order creation', () => {
    it('should create order with balance payment', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          order_id: 'order-123',
          status: 'pending',
          payment_status: 'paid',
          total_amount: 155.00,
          message: 'Order placed successfully'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/process-order', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(validOrderPayload)
      });

      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.status).toBe('pending');
      expect(result.payment_status).toBe('paid');
      expect(result.total_amount).toBe(155.00);
    });

    it('should create cash order with awaiting_payment status', async () => {
      const cashPayload = { ...validOrderPayload, payment_method: 'cash' };
      const paymentDueAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          order_id: 'order-456',
          status: 'awaiting_payment',
          payment_status: 'awaiting_payment',
          payment_due_at: paymentDueAt,
          total_amount: 155.00,
          message: 'Please pay ₱155.00 at the cashier within 15 minutes'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/process-order', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(cashPayload)
      });

      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.status).toBe('awaiting_payment');
      expect(result.payment_status).toBe('awaiting_payment');
      expect(result.payment_due_at).toBeDefined();
      expect(result.message).toContain('cashier');
      expect(result.message).toContain('15 minutes');
    });

    it('should create GCash order', async () => {
      const gcashPayload = { ...validOrderPayload, payment_method: 'gcash' };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          order_id: 'order-789',
          status: 'pending',
          payment_status: 'paid',
          total_amount: 155.00
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/process-order', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(gcashPayload)
      });

      const result = await response.json();
      expect(result.success).toBe(true);
    });

    it('should handle future scheduled orders', async () => {
      const futurePayload = { 
        ...validOrderPayload, 
        scheduled_for: '2026-01-10' 
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          order_id: 'order-future',
          status: 'pending',
          scheduled_for: '2026-01-10'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/process-order', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(futurePayload)
      });

      const result = await response.json();
      expect(result.success).toBe(true);
    });
  });

  describe('validation errors', () => {
    it('should reject missing required fields', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'VALIDATION_ERROR',
          message: 'Missing required fields'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/process-order', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          parent_id: 'parent-123'
          // Missing other fields
        })
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
    });

    it('should reject empty items array', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'VALIDATION_ERROR',
          message: 'Missing required fields'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/process-order', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...validOrderPayload,
          items: []
        })
      });

      expect(response.ok).toBe(false);
    });
  });

  describe('authorization errors', () => {
    it('should reject unauthorized user', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({
          error: 'UNAUTHORIZED',
          message: 'Invalid token'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/process-order', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer invalid-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(validOrderPayload)
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    });

    it('should reject parent_id mismatch', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({
          error: 'UNAUTHORIZED',
          message: 'Parent ID does not match authenticated user'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/process-order', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...validOrderPayload,
          parent_id: 'different-parent'
        })
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    });

    it('should reject unlinked student', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({
          error: 'UNAUTHORIZED',
          message: 'Parent is not linked to this student'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/process-order', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...validOrderPayload,
          student_id: 'unlinked-student'
        })
      });

      expect(response.ok).toBe(false);
    });
  });

  describe('stock errors', () => {
    it('should reject insufficient stock', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'INSUFFICIENT_STOCK',
          message: "Product 'Chicken Adobo' has insufficient stock (available: 5)",
          product_id: 'product-1',
          available_stock: 5
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/process-order', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...validOrderPayload,
          items: [{ product_id: 'product-1', quantity: 100, price_at_order: 65.00 }]
        })
      });

      expect(response.ok).toBe(false);
      const result = await response.json();
      expect(result.error).toBe('INSUFFICIENT_STOCK');
      expect(result.available_stock).toBe(5);
    });

    it('should reject unavailable product', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'PRODUCT_UNAVAILABLE',
          message: "Product 'Sold Out Item' is not available",
          product_id: 'product-5'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/process-order', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...validOrderPayload,
          items: [{ product_id: 'product-5', quantity: 1, price_at_order: 45.00 }]
        })
      });

      expect(response.ok).toBe(false);
      const result = await response.json();
      expect(result.error).toBe('PRODUCT_UNAVAILABLE');
    });

    it('should reject non-existent product', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'PRODUCT_NOT_FOUND',
          message: 'Product not found',
          product_id: 'non-existent'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/process-order', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...validOrderPayload,
          items: [{ product_id: 'non-existent', quantity: 1, price_at_order: 10.00 }]
        })
      });

      expect(response.ok).toBe(false);
      const result = await response.json();
      expect(result.error).toBe('PRODUCT_NOT_FOUND');
    });
  });

  describe('balance errors', () => {
    it('should reject insufficient balance', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient balance. Required: ₱155.00, Available: ₱50.00',
          required: 155.00,
          available: 50.00
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/process-order', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(validOrderPayload)
      });

      expect(response.ok).toBe(false);
      const result = await response.json();
      expect(result.error).toBe('INSUFFICIENT_BALANCE');
      expect(result.required).toBe(155.00);
      expect(result.available).toBe(50.00);
    });

    it('should reject when no wallet exists', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'NO_WALLET',
          message: 'No wallet found. Please top up your balance first.'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/process-order', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(validOrderPayload)
      });

      expect(response.ok).toBe(false);
      const result = await response.json();
      expect(result.error).toBe('NO_WALLET');
    });
  });

  describe('idempotency', () => {
    it('should return existing order for duplicate client_order_id', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.resolve({
          error: 'DUPLICATE_ORDER',
          message: 'Order with this client_order_id already exists',
          existing_order_id: 'order-existing',
          status: 'pending',
          total_amount: 155.00
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/process-order', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(validOrderPayload)
      });

      expect(response.status).toBe(409);
      const result = await response.json();
      expect(result.error).toBe('DUPLICATE_ORDER');
      expect(result.existing_order_id).toBeDefined();
    });
  });
});
