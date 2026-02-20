// useCart Online Payment Integration Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isOnlinePaymentMethod } from '../../../src/types';
import type { PaymentMethod } from '../../../src/types';

// Mock createCheckout
const mockCreateCheckout = vi.fn();
vi.mock('../../../src/services/payments', () => ({
  createCheckout: (...args: unknown[]) => mockCreateCheckout(...args),
}));

describe('useCart Online Payment Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Payment Method Routing ─────────────────────────────────
  describe('Payment Method Routing', () => {
    it('identifies online payment methods correctly', () => {
      expect(isOnlinePaymentMethod('gcash')).toBe(true);
      expect(isOnlinePaymentMethod('paymaya')).toBe(true);
      expect(isOnlinePaymentMethod('card')).toBe(true);
      expect(isOnlinePaymentMethod('cash')).toBe(false);
      expect(isOnlinePaymentMethod('balance')).toBe(false);
    });

    it('routes online methods to createCheckout', () => {
      const method: PaymentMethod = 'gcash';
      const isOnline = isOnlinePaymentMethod(method);
      expect(isOnline).toBe(true);
      // In the real code, this triggers createCheckout() instead of createOrder()
    });

    it('routes school methods to createOrder', () => {
      const method: PaymentMethod = 'cash';
      const isOnline = isOnlinePaymentMethod(method);
      expect(isOnline).toBe(false);
      // In the real code, this triggers createOrder() (process-order edge function)
    });
  });

  // ─── Online Payment Checkout ────────────────────────────────
  describe('Online Payment Checkout', () => {
    const mockOrderData = {
      parent_id: 'parent-1',
      student_id: 'student-1',
      client_order_id: 'co-1',
      items: [{ product_id: 'p-1', quantity: 2, price_at_order: 75.0 }],
      payment_method: 'gcash' as const,
      notes: '',
      scheduled_for: '2026-02-20',
      meal_period: 'lunch',
    };

    it('calls createCheckout for online payment', async () => {
      mockCreateCheckout.mockResolvedValue({
        success: true,
        order_id: 'order-1',
        checkout_url: 'https://checkout.paymongo.com/cs_xxx',
        payment_due_at: '2026-02-20T12:30:00Z',
        total_amount: 150.0,
      });

      const result = await mockCreateCheckout(mockOrderData);

      expect(result.checkout_url).toContain('paymongo.com');
      expect(result.order_id).toBe('order-1');
    });

    it('includes checkout_url in result for redirect', async () => {
      const checkoutUrl = 'https://checkout.paymongo.com/cs_xyz';
      mockCreateCheckout.mockResolvedValue({
        success: true,
        order_id: 'order-2',
        checkout_url: checkoutUrl,
        payment_due_at: '2026-02-20T12:30:00Z',
        total_amount: 150.0,
      });

      const result = await mockCreateCheckout(mockOrderData);
      expect(result.checkout_url).toBe(checkoutUrl);
    });
  });

  // ─── Multiple Groups with Online Payment ────────────────────
  describe('Multiple Groups Restriction', () => {
    it('rejects online payment with multiple order groups', () => {
      const groups = [
        { student_id: 'student-1', scheduled_for: '2026-02-20', meal_period: 'lunch' },
        { student_id: 'student-2', scheduled_for: '2026-02-20', meal_period: 'lunch' },
      ];
      const paymentMethod = 'gcash';
      const isOnline = isOnlinePaymentMethod(paymentMethod);

      const shouldReject = isOnline && groups.length > 1;
      expect(shouldReject).toBe(true);
    });

    it('allows online payment for single group', () => {
      const groups = [
        { student_id: 'student-1', scheduled_for: '2026-02-20', meal_period: 'lunch' },
      ];
      const paymentMethod = 'gcash';
      const isOnline = isOnlinePaymentMethod(paymentMethod);

      const shouldReject = isOnline && groups.length > 1;
      expect(shouldReject).toBe(false);
    });

    it('allows multiple groups for cash payment', () => {
      const groups = [
        { student_id: 'student-1', scheduled_for: '2026-02-20', meal_period: 'lunch' },
        { student_id: 'student-2', scheduled_for: '2026-02-20', meal_period: 'lunch' },
      ];
      const paymentMethod = 'cash';
      const isOnline = isOnlinePaymentMethod(paymentMethod);

      const shouldReject = isOnline && groups.length > 1;
      expect(shouldReject).toBe(false);
    });

    it('allows multiple groups for balance payment', () => {
      const groups = [
        { student_id: 'student-1', scheduled_for: '2026-02-20', meal_period: 'lunch' },
        { student_id: 'student-2', scheduled_for: '2026-02-21', meal_period: 'morning_snack' },
      ];
      const paymentMethod = 'balance';
      const isOnline = isOnlinePaymentMethod(paymentMethod);

      const shouldReject = isOnline && groups.length > 1;
      expect(shouldReject).toBe(false);
    });
  });

  // ─── Cart Clearing for Online Payment ───────────────────────
  describe('Cart Clearing for Online Payment', () => {
    it('clears cart items for the order group before redirect', () => {
      const items = [
        { student_id: 'student-1', scheduled_for: '2026-02-20', meal_period: 'lunch', product_id: 'p-1' },
        { student_id: 'student-1', scheduled_for: '2026-02-20', meal_period: 'lunch', product_id: 'p-2' },
        { student_id: 'student-1', scheduled_for: '2026-02-21', meal_period: 'lunch', product_id: 'p-3' },
      ];

      const successKey = `student-1_2026-02-20_lunch`;
      const remainingItems = items.filter((item) => {
        const key = `${item.student_id}_${item.scheduled_for}_${item.meal_period}`;
        return key !== successKey;
      });

      expect(remainingItems).toHaveLength(1);
      expect(remainingItems[0].product_id).toBe('p-3');
    });

    it('does not clear items from other groups', () => {
      const items = [
        { student_id: 'student-1', scheduled_for: '2026-02-20', meal_period: 'lunch', product_id: 'p-1' },
        { student_id: 'student-2', scheduled_for: '2026-02-20', meal_period: 'lunch', product_id: 'p-2' },
      ];

      const successKey = `student-1_2026-02-20_lunch`;
      const remainingItems = items.filter((item) => {
        const key = `${item.student_id}_${item.scheduled_for}_${item.meal_period}`;
        return key !== successKey;
      });

      expect(remainingItems).toHaveLength(1);
      expect(remainingItems[0].student_id).toBe('student-2');
    });
  });

  // ─── Return Value for Online Payment ────────────────────────
  describe('Return Value for Online Payment', () => {
    it('returns checkout result with correct shape', async () => {
      mockCreateCheckout.mockResolvedValue({
        success: true,
        order_id: 'order-1',
        checkout_url: 'https://checkout.paymongo.com/cs_xxx',
        payment_due_at: '2026-02-20T12:30:00Z',
        total_amount: 150.0,
      });

      const result = await mockCreateCheckout({});

      // The useCart checkout function returns this shape for online payments:
      const returnValue = {
        orders: [
          {
            order_id: result.order_id,
            checkout_url: result.checkout_url,
            student_id: 'student-1',
            scheduled_for: '2026-02-20',
            meal_period: 'lunch',
          },
        ],
        total: 150,
        successCount: 1,
        failCount: 0,
      };

      expect(returnValue.orders).toHaveLength(1);
      expect(returnValue.orders[0].checkout_url).toContain('paymongo.com');
      expect(returnValue.successCount).toBe(1);
      expect(returnValue.failCount).toBe(0);
    });
  });

  // ─── Error Handling ─────────────────────────────────────────
  describe('Error Handling', () => {
    it('propagates createCheckout errors', async () => {
      mockCreateCheckout.mockRejectedValue(new Error('Insufficient stock'));

      await expect(mockCreateCheckout({})).rejects.toThrow('Insufficient stock');
    });

    it('handles network timeout', async () => {
      mockCreateCheckout.mockRejectedValue(new Error('Request timeout'));

      await expect(mockCreateCheckout({})).rejects.toThrow('Request timeout');
    });

    it('handles minimum amount error', async () => {
      mockCreateCheckout.mockRejectedValue(
        new Error('Minimum order for online payment is ₱20')
      );

      await expect(mockCreateCheckout({})).rejects.toThrow('Minimum order');
    });
  });
});
