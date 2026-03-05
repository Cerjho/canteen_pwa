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
  checkPaymentStatus,
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

  // ─── getPaymentMethodLabel ──────────────────────────────────
  describe('getPaymentMethodLabel', () => {
    it('returns "Cash" for cash', () => {
      expect(getPaymentMethodLabel('cash')).toBe('Cash');
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

    it('returns "Place Order" for cash', () => {
      expect(getCheckoutButtonText('cash')).toBe('Place Order');
    });
  });
});
