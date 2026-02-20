// Payment Service Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase client
const mockInvoke = vi.fn();
const mockGetSession = vi.fn();
const mockRefreshSession = vi.fn();

vi.mock('../../../src/services/supabaseClient', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
    auth: {
      getSession: () => mockGetSession(),
      refreshSession: () => mockRefreshSession(),
    },
  },
}));

// Mock authSession module
const mockEnsureValidSession = vi.fn();
vi.mock('../../../src/services/authSession', () => ({
  ensureValidSession: (...args: unknown[]) => mockEnsureValidSession(...args),
}));

import {
  createCheckout,
  createTopupCheckout,
  checkPaymentStatus,
  checkTopupStatus,
  getPaymentMethodLabel,
  getCheckoutButtonText,
} from '../../../src/services/payments';

describe('Payment Service', () => {
  const validSession = {
    data: {
      session: {
        user: { id: 'user-1' },
        access_token: 'tok',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    },
    error: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock ensureValidSession to return a valid session by default
    mockEnsureValidSession.mockResolvedValue(validSession.data.session);
    mockGetSession.mockResolvedValue(validSession);
    mockRefreshSession.mockResolvedValue({
      data: { session: validSession.data.session },
      error: null,
    });
  });

  // ─── createCheckout ─────────────────────────────────────────
  describe('createCheckout', () => {
    const mockOrderData = {
      parent_id: 'parent-123',
      student_id: 'child-1',
      client_order_id: 'client-order-1',
      items: [{ product_id: 'product-1', quantity: 2, price_at_order: 65.0 }],
      payment_method: 'gcash' as const,
      notes: 'No spicy',
      scheduled_for: '2026-02-20',
      meal_period: 'lunch',
    };

    it('invokes create-checkout edge function with order data', async () => {
      mockInvoke.mockResolvedValue({
        data: {
          success: true,
          order_id: 'order-1',
          checkout_url: 'https://checkout.paymongo.com/cs_xxx',
          payment_due_at: '2026-02-20T12:30:00Z',
          total_amount: 130.0,
        },
        error: null,
      });

      const result = await createCheckout(mockOrderData);

      expect(mockInvoke).toHaveBeenCalledWith('create-checkout', {
        body: mockOrderData,
      });
      expect(result.success).toBe(true);
      expect(result.checkout_url).toContain('paymongo.com');
      expect(result.order_id).toBe('order-1');
      expect(result.total_amount).toBe(130.0);
    });

    it('throws error when session is missing', async () => {
      mockEnsureValidSession.mockRejectedValue(new Error('Please sign in again'));

      await expect(createCheckout(mockOrderData)).rejects.toThrow(
        'Please sign in again'
      );
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('throws error when getSession returns error', async () => {
      mockEnsureValidSession.mockRejectedValue(new Error('Please sign in again'));

      await expect(createCheckout(mockOrderData)).rejects.toThrow(
        'Please sign in again'
      );
    });

    it('uses ensureValidSession which handles token refresh internally', async () => {
      // ensureValidSession handles refresh internally, so we just verify it's called
      // and the result allows the function to proceed
      const refreshedSession = {
        user: { id: 'user-1' },
        access_token: 'tok-refreshed',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };
      mockEnsureValidSession.mockResolvedValue(refreshedSession);
      mockInvoke.mockResolvedValue({
        data: {
          success: true,
          order_id: 'order-1',
          checkout_url: 'https://checkout.test',
          payment_due_at: '2026-02-20T12:30:00Z',
          total_amount: 130.0,
        },
        error: null,
      });

      await createCheckout(mockOrderData);

      expect(mockEnsureValidSession).toHaveBeenCalled();
      expect(mockInvoke).toHaveBeenCalled();
    });

    it('throws error when session validation fails', async () => {
      // ensureValidSession throws when refresh fails
      mockEnsureValidSession.mockRejectedValue(new Error('Session expired'));

      await expect(createCheckout(mockOrderData)).rejects.toThrow(
        'Session expired'
      );
    });

    it('throws error from edge function response', async () => {
      mockInvoke.mockResolvedValue({
        data: null,
        error: { message: 'Insufficient stock' },
      });

      await expect(createCheckout(mockOrderData)).rejects.toThrow(
        'out of stock'
      );
    });

    it('throws error when data contains error field', async () => {
      mockInvoke.mockResolvedValue({
        data: { error: 'PRODUCT_UNAVAILABLE', message: 'Product is no longer available' },
        error: null,
      });

      await expect(createCheckout(mockOrderData)).rejects.toThrow(
        'Product is no longer available'
      );
    });

    it('prefers data.message over error.message', async () => {
      mockInvoke.mockResolvedValue({
        data: { message: 'Minimum order is ₱20' },
        error: { message: 'Function error' },
      });

      await expect(createCheckout(mockOrderData)).rejects.toThrow(
        'Minimum order is ₱20'
      );
    });

    it('works with paymaya payment method', async () => {
      const paymayaOrder = { ...mockOrderData, payment_method: 'paymaya' as const };
      mockInvoke.mockResolvedValue({
        data: {
          success: true,
          order_id: 'order-2',
          checkout_url: 'https://checkout.paymongo.com/cs_yyy',
          payment_due_at: '2026-02-20T12:30:00Z',
          total_amount: 130.0,
        },
        error: null,
      });

      const result = await createCheckout(paymayaOrder);
      expect(result.order_id).toBe('order-2');
    });

    it('works with card payment method', async () => {
      const cardOrder = { ...mockOrderData, payment_method: 'card' as const };
      mockInvoke.mockResolvedValue({
        data: {
          success: true,
          order_id: 'order-3',
          checkout_url: 'https://checkout.paymongo.com/cs_zzz',
          payment_due_at: '2026-02-20T12:30:00Z',
          total_amount: 130.0,
        },
        error: null,
      });

      const result = await createCheckout(cardOrder);
      expect(result.order_id).toBe('order-3');
    });
  });

  // ─── createTopupCheckout ────────────────────────────────────
  describe('createTopupCheckout', () => {
    it('invokes create-topup-checkout with amount and method', async () => {
      mockInvoke.mockResolvedValue({
        data: {
          success: true,
          topup_session_id: 'topup-1',
          checkout_url: 'https://checkout.paymongo.com/cs_topup',
          expires_at: '2026-02-20T12:30:00Z',
          amount: 500,
        },
        error: null,
      });

      const result = await createTopupCheckout({ amount: 500, payment_method: 'gcash' });

      expect(mockInvoke).toHaveBeenCalledWith('create-topup-checkout', {
        body: { amount: 500, payment_method: 'gcash' },
      });
      expect(result.success).toBe(true);
      expect(result.topup_session_id).toBe('topup-1');
      expect(result.checkout_url).toContain('paymongo.com');
      expect(result.amount).toBe(500);
    });

    it('throws error when not authenticated', async () => {
      mockEnsureValidSession.mockRejectedValue(new Error('Please sign in again'));

      await expect(
        createTopupCheckout({ amount: 500, payment_method: 'gcash' })
      ).rejects.toThrow('Please sign in again');
    });

    it('throws error on edge function failure', async () => {
      mockInvoke.mockResolvedValue({
        data: null,
        error: { message: 'Amount too low' },
      });

      await expect(
        createTopupCheckout({ amount: 10, payment_method: 'gcash' })
      ).rejects.toThrow('Amount too low');
    });

    it('throws error when data contains error response', async () => {
      mockInvoke.mockResolvedValue({
        data: { error: 'INVALID_AMOUNT', message: 'Minimum top-up is ₱50' },
        error: null,
      });

      await expect(
        createTopupCheckout({ amount: 20, payment_method: 'gcash' })
      ).rejects.toThrow('Minimum top-up is ₱50');
    });

    it('works without specifying payment method', async () => {
      mockInvoke.mockResolvedValue({
        data: {
          success: true,
          topup_session_id: 'topup-2',
          checkout_url: 'https://checkout.paymongo.com/cs_all',
          expires_at: '2026-02-20T12:30:00Z',
          amount: 1000,
        },
        error: null,
      });

      const result = await createTopupCheckout({ amount: 1000 });

      expect(mockInvoke).toHaveBeenCalledWith('create-topup-checkout', {
        body: { amount: 1000 },
      });
      expect(result.amount).toBe(1000);
    });
  });

  // ─── checkPaymentStatus ─────────────────────────────────────
  describe('checkPaymentStatus', () => {
    it('invokes check-payment-status with order_id', async () => {
      mockInvoke.mockResolvedValue({
        data: {
          order_id: 'order-1',
          payment_status: 'paid',
          order_status: 'pending',
          payment_method: 'gcash',
          total_amount: 130.0,
        },
        error: null,
      });

      const result = await checkPaymentStatus('order-1');

      expect(mockInvoke).toHaveBeenCalledWith('check-payment-status', {
        body: { order_id: 'order-1' },
      });
      expect(result.payment_status).toBe('paid');
      expect(result.order_status).toBe('pending');
    });

    it('returns awaiting_payment status for unpaid orders', async () => {
      mockInvoke.mockResolvedValue({
        data: {
          order_id: 'order-1',
          payment_status: 'awaiting_payment',
          order_status: 'awaiting_payment',
          payment_method: 'paymaya',
          total_amount: 200.0,
        },
        error: null,
      });

      const result = await checkPaymentStatus('order-1');
      expect(result.payment_status).toBe('awaiting_payment');
    });

    it('returns timeout status for expired payments', async () => {
      mockInvoke.mockResolvedValue({
        data: {
          order_id: 'order-1',
          payment_status: 'timeout',
          order_status: 'cancelled',
        },
        error: null,
      });

      const result = await checkPaymentStatus('order-1');
      expect(result.payment_status).toBe('timeout');
      expect(result.order_status).toBe('cancelled');
    });

    it('throws error on failure', async () => {
      mockInvoke.mockResolvedValue({
        data: null,
        error: { message: 'Order not found' },
      });

      await expect(checkPaymentStatus('invalid-id')).rejects.toThrow(
        'Order not found'
      );
    });
  });

  // ─── checkTopupStatus ───────────────────────────────────────
  describe('checkTopupStatus', () => {
    it('invokes check-payment-status with topup_session_id', async () => {
      mockInvoke.mockResolvedValue({
        data: {
          topup_session_id: 'topup-1',
          status: 'completed',
          amount: 500,
          completed_at: '2026-02-20T12:30:00Z',
        },
        error: null,
      });

      const result = await checkTopupStatus('topup-1');

      expect(mockInvoke).toHaveBeenCalledWith('check-payment-status', {
        body: { topup_session_id: 'topup-1' },
      });
      expect(result.status).toBe('completed');
      expect(result.amount).toBe(500);
    });

    it('returns pending status for unprocessed top-ups', async () => {
      mockInvoke.mockResolvedValue({
        data: {
          topup_session_id: 'topup-1',
          status: 'pending',
          amount: 500,
        },
        error: null,
      });

      const result = await checkTopupStatus('topup-1');
      expect(result.status).toBe('pending');
    });

    it('throws error on failure', async () => {
      mockInvoke.mockResolvedValue({
        data: null,
        error: { message: 'Session not found' },
      });

      await expect(checkTopupStatus('invalid-id')).rejects.toThrow(
        'Session not found'
      );
    });
  });

  // ─── getPaymentMethodLabel ──────────────────────────────────
  describe('getPaymentMethodLabel', () => {
    it('returns "Cash" for cash', () => {
      expect(getPaymentMethodLabel('cash')).toBe('Cash');
    });

    it('returns "Wallet Balance" for balance', () => {
      expect(getPaymentMethodLabel('balance')).toBe('Wallet Balance');
    });

    it('returns "GCash" for gcash', () => {
      expect(getPaymentMethodLabel('gcash')).toBe('GCash');
    });

    it('returns "PayMaya" for paymaya', () => {
      expect(getPaymentMethodLabel('paymaya')).toBe('PayMaya');
    });

    it('returns "Credit/Debit Card" for card', () => {
      expect(getPaymentMethodLabel('card')).toBe('Credit/Debit Card');
    });

    it('returns the raw string for unknown methods', () => {
      expect(getPaymentMethodLabel('bitcoin')).toBe('bitcoin');
    });
  });

  // ─── getCheckoutButtonText ──────────────────────────────────
  describe('getCheckoutButtonText', () => {
    it('returns "Pay with GCash" for gcash', () => {
      expect(getCheckoutButtonText('gcash')).toBe('Pay with GCash');
    });

    it('returns "Pay with PayMaya" for paymaya', () => {
      expect(getCheckoutButtonText('paymaya')).toBe('Pay with PayMaya');
    });

    it('returns "Pay with Card" for card', () => {
      expect(getCheckoutButtonText('card')).toBe('Pay with Card');
    });

    it('returns "Pay with Balance" for balance', () => {
      expect(getCheckoutButtonText('balance')).toBe('Pay with Balance');
    });

    it('returns "Place Order" for cash', () => {
      expect(getCheckoutButtonText('cash')).toBe('Place Order');
    });
  });
});
