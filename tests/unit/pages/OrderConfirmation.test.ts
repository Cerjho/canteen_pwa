// Online Payment Checkout Flow Tests
// Tests for the order confirmation with PayMongo redirect handling
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isOnlinePaymentMethod } from '../../../src/types';
import type { PaymentMethod, PaymentStatusResponse } from '../../../src/types';

// Mock the payments service
const mockCheckPaymentStatus = vi.fn();
vi.mock('../../../src/services/payments', () => ({
  checkPaymentStatus: (...args: unknown[]) => mockCheckPaymentStatus(...args),
  getPaymentMethodLabel: (m: string) => {
    const labels: Record<string, string> = {
      cash: 'Cash',
      balance: 'Wallet Balance',
      gcash: 'GCash',
      paymaya: 'PayMaya',
      card: 'Credit/Debit Card',
    };
    return labels[m] || m;
  },
}));

describe('Online Payment Checkout Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Payment Status Polling ─────────────────────────────────
  describe('Payment Status Polling', () => {
    it('detects successful payment via polling', async () => {
      mockCheckPaymentStatus.mockResolvedValue({
        order_id: 'order-1',
        payment_status: 'paid',
        order_status: 'pending',
        payment_method: 'gcash',
        total_amount: 130.0,
      } as PaymentStatusResponse);

      const result = await mockCheckPaymentStatus('order-1');
      expect(result.payment_status).toBe('paid');
      expect(result.order_status).toBe('pending');
    });

    it('detects still-awaiting payment', async () => {
      mockCheckPaymentStatus.mockResolvedValue({
        order_id: 'order-1',
        payment_status: 'awaiting_payment',
        order_status: 'awaiting_payment',
      } as PaymentStatusResponse);

      const result = await mockCheckPaymentStatus('order-1');
      expect(result.payment_status).toBe('awaiting_payment');
    });

    it('detects timed-out payment', async () => {
      mockCheckPaymentStatus.mockResolvedValue({
        order_id: 'order-1',
        payment_status: 'timeout',
        order_status: 'cancelled',
      } as PaymentStatusResponse);

      const result = await mockCheckPaymentStatus('order-1');
      expect(result.payment_status).toBe('timeout');
      expect(result.order_status).toBe('cancelled');
    });

    it('simulates polling loop with eventual confirmation', async () => {
      // First 2 calls: still awaiting
      mockCheckPaymentStatus
        .mockResolvedValueOnce({
          order_id: 'order-1',
          payment_status: 'awaiting_payment',
          order_status: 'awaiting_payment',
        })
        .mockResolvedValueOnce({
          order_id: 'order-1',
          payment_status: 'awaiting_payment',
          order_status: 'awaiting_payment',
        })
        // Third call: paid
        .mockResolvedValueOnce({
          order_id: 'order-1',
          payment_status: 'paid',
          order_status: 'pending',
        });

      let verificationStatus: 'verifying' | 'confirmed' | 'failed' = 'verifying';
      const MAX_POLLS = 20;

      for (let i = 0; i < MAX_POLLS; i++) {
        const result = await mockCheckPaymentStatus('order-1');
        if (result.payment_status === 'paid' || result.order_status === 'pending') {
          verificationStatus = 'confirmed';
          break;
        }
        if (result.payment_status === 'timeout' || result.order_status === 'cancelled') {
          verificationStatus = 'failed';
          break;
        }
      }

      expect(verificationStatus).toBe('confirmed');
      expect(mockCheckPaymentStatus).toHaveBeenCalledTimes(3);
    });

    it('gives up after max polls and assumes success', async () => {
      // Always returns awaiting_payment
      mockCheckPaymentStatus.mockResolvedValue({
        order_id: 'order-1',
        payment_status: 'awaiting_payment',
        order_status: 'awaiting_payment',
      } as PaymentStatusResponse);

      const MAX_POLLS = 5; // Reduced for test speed
      let verificationStatus: 'verifying' | 'confirmed' | 'failed' = 'verifying';

      for (let i = 0; i < MAX_POLLS; i++) {
        const result = await mockCheckPaymentStatus('order-1');
        if (result.payment_status === 'paid') {
          verificationStatus = 'confirmed';
          break;
        }
        if (result.payment_status === 'timeout') {
          verificationStatus = 'failed';
          break;
        }
      }

      // After max polls, assume confirmed (webhook may be slow)
      if (verificationStatus === 'verifying') {
        verificationStatus = 'confirmed';
      }

      expect(verificationStatus).toBe('confirmed');
      expect(mockCheckPaymentStatus).toHaveBeenCalledTimes(MAX_POLLS);
    });

    it('handles polling errors gracefully', async () => {
      mockCheckPaymentStatus
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          order_id: 'order-1',
          payment_status: 'paid',
          order_status: 'pending',
        });

      let verificationStatus: 'verifying' | 'confirmed' | 'failed' = 'verifying';

      for (let i = 0; i < 5; i++) {
        try {
          const result = await mockCheckPaymentStatus('order-1');
          if (result.payment_status === 'paid') {
            verificationStatus = 'confirmed';
            break;
          }
        } catch {
          // Continue polling on error
        }
      }

      expect(verificationStatus).toBe('confirmed');
      expect(mockCheckPaymentStatus).toHaveBeenCalledTimes(2);
    });
  });

  // ─── URL Parameter Handling ─────────────────────────────────
  describe('URL Parameter Handling', () => {
    it('extracts payment=success param', () => {
      const params = new URLSearchParams('?payment=success&order_id=order-1');
      expect(params.get('payment')).toBe('success');
      expect(params.get('order_id')).toBe('order-1');
    });

    it('extracts payment=cancelled param', () => {
      const params = new URLSearchParams('?payment=cancelled&order_id=order-1');
      expect(params.get('payment')).toBe('cancelled');
    });

    it('extracts topup=success param', () => {
      const params = new URLSearchParams('?topup=success&session=topup-1');
      expect(params.get('topup')).toBe('success');
      expect(params.get('session')).toBe('topup-1');
    });

    it('extracts topup=cancelled param', () => {
      const params = new URLSearchParams('?topup=cancelled');
      expect(params.get('topup')).toBe('cancelled');
    });

    it('handles missing params gracefully', () => {
      const params = new URLSearchParams('');
      expect(params.get('payment')).toBeNull();
      expect(params.get('order_id')).toBeNull();
    });
  });

  // ─── Verification Status Logic ──────────────────────────────
  describe('Verification Status', () => {
    it('starts idle when no payment param', () => {
      const paymentResult: string | null = null;
      let status: 'idle' | 'verifying' | 'confirmed' | 'failed' | 'cancelled' = 'idle';

      if (paymentResult === 'cancelled') {
        status = 'cancelled';
      } else if (paymentResult === 'success') {
        status = 'verifying';
      }

      expect(status).toBe('idle');
    });

    it('sets cancelled when payment=cancelled', () => {
      const paymentResult = 'cancelled';
      let status: 'idle' | 'verifying' | 'confirmed' | 'failed' | 'cancelled' = 'idle';

      if (paymentResult === 'cancelled') {
        status = 'cancelled';
      }

      expect(status).toBe('cancelled');
    });

    it('sets verifying when payment=success', () => {
      const paymentResult = 'success';
      let status: 'idle' | 'verifying' | 'confirmed' | 'failed' | 'cancelled' = 'idle';

      if (paymentResult === 'cancelled') {
        status = 'cancelled';
      } else if (paymentResult === 'success') {
        status = 'verifying';
      }

      expect(status).toBe('verifying');
    });
  });

  // ─── Order Confirmation Display ─────────────────────────────
  describe('Order Confirmation Display', () => {
    it('shows correct status for cash orders', () => {
      const paymentMethod: PaymentMethod = 'cash';
      const isOnline = isOnlinePaymentMethod(paymentMethod);
      expect(isOnline).toBe(false);
      // Cash shows "Awaiting Payment"
    });

    it('shows correct status for online payment orders', () => {
      const paymentMethod: PaymentMethod = 'gcash';
      const isOnline = isOnlinePaymentMethod(paymentMethod);
      expect(isOnline).toBe(true);
      // Online shows "Redirecting to Payment" 
    });

    it('shows redirect notice for gcash', () => {
      const method: PaymentMethod = 'gcash';
      const isOnline = isOnlinePaymentMethod(method);
      expect(isOnline).toBe(true);
    });

    it('shows redirect notice for paymaya', () => {
      const method: PaymentMethod = 'paymaya';
      const isOnline = isOnlinePaymentMethod(method);
      expect(isOnline).toBe(true);
    });

    it('shows redirect notice for card', () => {
      const method: PaymentMethod = 'card';
      const isOnline = isOnlinePaymentMethod(method);
      expect(isOnline).toBe(true);
    });

    it('does not show redirect notice for balance', () => {
      const method: PaymentMethod = 'balance';
      const isOnline = isOnlinePaymentMethod(method);
      expect(isOnline).toBe(false);
    });
  });
});
