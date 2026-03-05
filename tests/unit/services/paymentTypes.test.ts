// Payment Integration Types Tests
import { describe, it, expect } from 'vitest';
import {
  isOnlinePaymentMethod,
  ONLINE_PAYMENT_METHODS,
} from '../../../src/types';
import type {
  PaymentMethod,
  PaymentStatus,
  Order,
  Transaction,
  CreateCheckoutResponse,
  PaymentStatusResponse,
} from '../../../src/types';

describe('Payment Types & Helpers', () => {
  // ─── PaymentMethod type coverage ────────────────────────────
  describe('PaymentMethod values', () => {
    it('should include all four valid payment methods', () => {
      const validMethods: PaymentMethod[] = ['cash', 'gcash', 'paymaya', 'card'];
      expect(validMethods).toHaveLength(4);
    });
  });

  // ─── ONLINE_PAYMENT_METHODS constant ────────────────────────
  describe('ONLINE_PAYMENT_METHODS', () => {
    it('contains gcash, paymaya, card', () => {
      expect(ONLINE_PAYMENT_METHODS).toContain('gcash');
      expect(ONLINE_PAYMENT_METHODS).toContain('paymaya');
      expect(ONLINE_PAYMENT_METHODS).toContain('card');
    });

    it('does NOT contain cash', () => {
      expect(ONLINE_PAYMENT_METHODS).not.toContain('cash');
    });

    it('has exactly 3 entries', () => {
      expect(ONLINE_PAYMENT_METHODS).toHaveLength(3);
    });
  });

  // ─── isOnlinePaymentMethod ──────────────────────────────────
  describe('isOnlinePaymentMethod', () => {
    it('returns true for gcash', () => {
      expect(isOnlinePaymentMethod('gcash')).toBe(true);
    });

    it('returns true for paymaya', () => {
      expect(isOnlinePaymentMethod('paymaya')).toBe(true);
    });

    it('returns true for card', () => {
      expect(isOnlinePaymentMethod('card')).toBe(true);
    });

    it('returns false for cash', () => {
      expect(isOnlinePaymentMethod('cash')).toBe(false);
    });

    it('returns false for unknown strings', () => {
      expect(isOnlinePaymentMethod('bitcoin')).toBe(false);
      expect(isOnlinePaymentMethod('')).toBe(false);
      expect(isOnlinePaymentMethod('GCASH')).toBe(false); // case-sensitive
    });

    it('accepts string type (not just PaymentMethod)', () => {
      const method: string = 'gcash';
      expect(isOnlinePaymentMethod(method)).toBe(true);
    });
  });

  // ─── Order interface with PayMongo fields ───────────────────
  describe('Order type with PayMongo fields', () => {
    it('can include paymongo_checkout_id and paymongo_payment_id', () => {
      const order: Order = {
        id: 'order-1',
        parent_id: 'parent-1',
        student_id: 'student-1',
        client_order_id: 'client-1',
        status: 'awaiting_payment',
        total_amount: 130.0,
        payment_method: 'gcash',
        payment_status: 'awaiting_payment',
        payment_due_at: '2026-02-20T12:30:00Z',
        paymongo_checkout_id: 'cs_xxx',
        paymongo_payment_id: 'pay_xxx',
        created_at: '2026-02-20T12:00:00Z',
        updated_at: '2026-02-20T12:00:00Z',
      };

      expect(order.paymongo_checkout_id).toBe('cs_xxx');
      expect(order.paymongo_payment_id).toBe('pay_xxx');
      expect(order.payment_method).toBe('gcash');
      expect(order.status).toBe('awaiting_payment');
    });

    it('paymongo fields are optional', () => {
      const order: Order = {
        id: 'order-2',
        parent_id: 'parent-1',
        student_id: 'student-1',
        client_order_id: 'client-2',
        status: 'pending',
        total_amount: 50.0,
        payment_method: 'cash',
        created_at: '2026-02-20T12:00:00Z',
        updated_at: '2026-02-20T12:00:00Z',
      };

      expect(order.paymongo_checkout_id).toBeUndefined();
      expect(order.paymongo_payment_id).toBeUndefined();
    });
  });

  // ─── Transaction interface with PayMongo fields ─────────────
  describe('Transaction type with PayMongo fields', () => {
    it('supports paymongo_payment_id, paymongo_refund_id, paymongo_checkout_id', () => {
      const tx: Transaction = {
        id: 'tx-1',
        parent_id: 'parent-1',
        order_id: 'order-1',
        type: 'payment',
        amount: 130.0,
        method: 'gcash',
        status: 'completed',
        paymongo_payment_id: 'pay_xxx',
        paymongo_checkout_id: 'cs_xxx',
        created_at: '2026-02-20T12:00:00Z',
      };

      expect(tx.paymongo_payment_id).toBe('pay_xxx');
      expect(tx.paymongo_checkout_id).toBe('cs_xxx');
    });

    it('supports refund transaction with paymongo_refund_id', () => {
      const tx: Transaction = {
        id: 'tx-2',
        parent_id: 'parent-1',
        order_id: 'order-1',
        type: 'refund',
        amount: 130.0,
        method: 'gcash',
        status: 'completed',
        paymongo_refund_id: 'ref_xxx',
        created_at: '2026-02-20T12:00:00Z',
      };

      expect(tx.paymongo_refund_id).toBe('ref_xxx');
      expect(tx.type).toBe('refund');
    });
  });

  // ─── Response interfaces ────────────────────────────────────
  describe('CreateCheckoutResponse', () => {
    it('has required fields', () => {
      const response: CreateCheckoutResponse = {
        success: true,
        order_id: 'order-1',
        checkout_url: 'https://checkout.paymongo.com/cs_xxx',
        payment_due_at: '2026-02-20T12:30:00Z',
        total_amount: 130.0,
      };

      expect(response.success).toBe(true);
      expect(response.checkout_url).toContain('https://');
      expect(response.order_id).toBeTruthy();
      expect(response.total_amount).toBeGreaterThan(0);
    });
  });

  describe('PaymentStatusResponse', () => {
    it('supports order payment status', () => {
      const response: PaymentStatusResponse = {
        order_id: 'order-1',
        payment_status: 'paid',
        order_status: 'pending',
        payment_method: 'gcash',
        total_amount: 130.0,
      };

      expect(response.payment_status).toBe('paid');
    });

    it('allows all PaymentStatus values', () => {
      const statuses: PaymentStatus[] = ['awaiting_payment', 'paid', 'timeout', 'refunded'];
      statuses.forEach((status) => {
        const response: PaymentStatusResponse = { payment_status: status };
        expect(response.payment_status).toBe(status);
      });
    });
  });
});
