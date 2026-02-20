// Dashboard Online Payment Status Tests
import { describe, it, expect } from 'vitest';
import { isOnlinePaymentMethod } from '../../../src/types';
import type { PaymentMethod } from '../../../src/types';

describe('Dashboard Payment Status Display', () => {
  // Helper matching the Dashboard's getStatusDetails logic
  function getStatusMessage(
    status: string,
    paymentStatus?: string,
    paymentMethod?: string
  ): string {
    if (paymentStatus === 'timeout') {
      return 'Payment expired - Order cancelled';
    }
    if (status === 'awaiting_payment' || paymentStatus === 'awaiting_payment') {
      const isOnline = paymentMethod ? isOnlinePaymentMethod(paymentMethod) : false;
      return isOnline ? 'Verifying payment...' : 'Pay at the counter';
    }
    switch (status) {
      case 'pending':
        return 'Waiting for kitchen';
      case 'preparing':
        return 'Being prepared now';
      case 'ready':
        return 'Ready for pickup';
      default:
        return '';
    }
  }

  // ─── Cash Orders ────────────────────────────────────────────
  describe('Cash Order Status', () => {
    it('shows "Pay at the counter" for cash awaiting_payment', () => {
      expect(getStatusMessage('awaiting_payment', 'awaiting_payment', 'cash')).toBe(
        'Pay at the counter'
      );
    });

    it('shows "Pay at the counter" for balance awaiting_payment', () => {
      expect(getStatusMessage('awaiting_payment', 'awaiting_payment', 'balance')).toBe(
        'Pay at the counter'
      );
    });
  });

  // ─── Online Payment Orders ──────────────────────────────────
  describe('Online Payment Order Status', () => {
    it('shows "Verifying payment..." for gcash awaiting_payment', () => {
      expect(getStatusMessage('awaiting_payment', 'awaiting_payment', 'gcash')).toBe(
        'Verifying payment...'
      );
    });

    it('shows "Verifying payment..." for paymaya awaiting_payment', () => {
      expect(getStatusMessage('awaiting_payment', 'awaiting_payment', 'paymaya')).toBe(
        'Verifying payment...'
      );
    });

    it('shows "Verifying payment..." for card awaiting_payment', () => {
      expect(getStatusMessage('awaiting_payment', 'awaiting_payment', 'card')).toBe(
        'Verifying payment...'
      );
    });
  });

  // ─── Timeout Status ─────────────────────────────────────────
  describe('Timeout Status', () => {
    it('shows timeout message regardless of payment method', () => {
      const methods: PaymentMethod[] = ['cash', 'balance', 'gcash', 'paymaya', 'card'];
      methods.forEach((method) => {
        expect(getStatusMessage('cancelled', 'timeout', method)).toBe(
          'Payment expired - Order cancelled'
        );
      });
    });

    it('timeout takes priority over awaiting_payment', () => {
      // Even if status is awaiting_payment, timeout paymentStatus wins
      expect(getStatusMessage('awaiting_payment', 'timeout', 'gcash')).toBe(
        'Payment expired - Order cancelled'
      );
    });
  });

  // ─── Normal Status Progression ──────────────────────────────
  describe('Normal Status Progression', () => {
    it('shows "Waiting for kitchen" for pending', () => {
      expect(getStatusMessage('pending')).toBe('Waiting for kitchen');
    });

    it('shows "Being prepared now" for preparing', () => {
      expect(getStatusMessage('preparing')).toBe('Being prepared now');
    });

    it('shows "Ready for pickup" for ready', () => {
      expect(getStatusMessage('ready')).toBe('Ready for pickup');
    });
  });

  // ─── Payment Countdown Banner ───────────────────────────────
  describe('Payment Countdown Banner', () => {
    it('shows "Verifying payment" for online orders', () => {
      const paymentMethod = 'gcash';
      const isOnline = isOnlinePaymentMethod(paymentMethod);
      const bannerText = isOnline ? 'Verifying payment' : 'Pay at counter';
      expect(bannerText).toBe('Verifying payment');
    });

    it('shows "Pay at counter" for cash orders', () => {
      const paymentMethod = 'cash';
      const isOnline = isOnlinePaymentMethod(paymentMethod);
      const bannerText = isOnline ? 'Verifying payment' : 'Pay at counter';
      expect(bannerText).toBe('Pay at counter');
    });

    it('shows "Verifying payment" for card orders', () => {
      const paymentMethod = 'card';
      const isOnline = isOnlinePaymentMethod(paymentMethod);
      const bannerText = isOnline ? 'Verifying payment' : 'Pay at counter';
      expect(bannerText).toBe('Verifying payment');
    });

    it('shows "Verifying payment" for paymaya orders', () => {
      const paymentMethod = 'paymaya';
      const isOnline = isOnlinePaymentMethod(paymentMethod);
      const bannerText = isOnline ? 'Verifying payment' : 'Pay at counter';
      expect(bannerText).toBe('Verifying payment');
    });
  });

  // ─── Overall Card Status with payment_method ────────────────
  describe('Overall Card Status uses payment_method', () => {
    it('passes payment_method to getStatusDetails for awaiting_payment', () => {
      // Simulates what Dashboard does
      const orders = [
        {
          status: 'awaiting_payment',
          payment_status: 'awaiting_payment',
          payment_method: 'gcash',
        },
      ];

      const awaitingOrder = orders.find(
        (o) => o.status === 'awaiting_payment' || o.payment_status === 'awaiting_payment'
      );

      expect(awaitingOrder).toBeDefined();
      const order = awaitingOrder as typeof orders[number];
      expect(order.payment_method).toBe('gcash');

      const statusMsg = getStatusMessage(
        'awaiting_payment',
        undefined,
        order.payment_method
      );
      expect(statusMsg).toBe('Verifying payment...');
    });

    it('falls back to "Pay at the counter" when payment_method is missing', () => {
      const statusMsg = getStatusMessage('awaiting_payment', 'awaiting_payment', undefined);
      expect(statusMsg).toBe('Pay at the counter');
    });
  });
});
