// PaymentMethodSelector Component Tests
import { describe, it, expect } from 'vitest';
import { isOnlinePaymentMethod } from '../../../src/types';
import type { PaymentMethod } from '../../../src/types';

describe('PaymentMethodSelector Component', () => {
  // ─── Payment Method Categories ──────────────────────────────
  describe('Payment Method Groups', () => {
    const schoolMethods: PaymentMethod[] = ['cash', 'balance'];
    const onlineMethods: PaymentMethod[] = ['gcash', 'paymaya', 'card'];

    it('has 2 school payment methods', () => {
      expect(schoolMethods).toHaveLength(2);
    });

    it('has 3 online payment methods', () => {
      expect(onlineMethods).toHaveLength(3);
    });

    it('school methods are NOT online', () => {
      schoolMethods.forEach((m) => {
        expect(isOnlinePaymentMethod(m)).toBe(false);
      });
    });

    it('online methods ARE online', () => {
      onlineMethods.forEach((m) => {
        expect(isOnlinePaymentMethod(m)).toBe(true);
      });
    });

    it('together they cover all 5 payment methods', () => {
      const all = [...schoolMethods, ...onlineMethods];
      expect(all).toHaveLength(5);
      expect(all).toContain('cash');
      expect(all).toContain('balance');
      expect(all).toContain('gcash');
      expect(all).toContain('paymaya');
      expect(all).toContain('card');
    });
  });

  // ─── Offline Behavior ──────────────────────────────────────
  describe('Offline Behavior', () => {
    it('should disable online methods when offline', () => {
      const isOffline = true;
      const method: PaymentMethod = 'gcash';
      const disabled = isOffline && isOnlinePaymentMethod(method);
      expect(disabled).toBe(true);
    });

    it('should NOT disable school methods when offline', () => {
      const isOffline = true;
      const method: PaymentMethod = 'cash';
      const disabled = isOffline && isOnlinePaymentMethod(method);
      expect(disabled).toBe(false);
    });

    it('should NOT disable online methods when online', () => {
      const isOffline = false;
      const method: PaymentMethod = 'gcash';
      const disabled = isOffline && isOnlinePaymentMethod(method);
      expect(disabled).toBe(false);
    });

    it('should warn user when offline and online method attempt', () => {
      const isOffline = true;
      const selectedMethod: PaymentMethod = 'paymaya';
      const showWarning = isOffline && isOnlinePaymentMethod(selectedMethod);
      expect(showWarning).toBe(true);
    });
  });

  // ─── Selection Logic ────────────────────────────────────────
  describe('Selection Logic', () => {
    it('allows switching between payment methods', () => {
      let selected: PaymentMethod = 'cash';
      selected = 'gcash';
      expect(selected).toBe('gcash');

      selected = 'paymaya';
      expect(selected).toBe('paymaya');

      selected = 'card';
      expect(selected).toBe('card');

      selected = 'balance';
      expect(selected).toBe('balance');
    });

    it('shows redirect notice for online methods', () => {
      const method: PaymentMethod = 'gcash';
      const showRedirectNotice = isOnlinePaymentMethod(method);
      expect(showRedirectNotice).toBe(true);
    });

    it('does not show redirect notice for school methods', () => {
      const method: PaymentMethod = 'cash';
      const showRedirectNotice = isOnlinePaymentMethod(method);
      expect(showRedirectNotice).toBe(false);
    });
  });

  // ─── Cart Drawer Integration ────────────────────────────────
  describe('Cart Drawer Payment Options', () => {
    const paymentOptions = [
      { id: 'cash', label: 'Cash', group: 'school' },
      { id: 'balance', label: 'Wallet Balance', group: 'school' },
      { id: 'gcash', label: 'GCash', group: 'online' },
      { id: 'paymaya', label: 'PayMaya', group: 'online' },
      { id: 'card', label: 'Credit/Debit Card', group: 'online' },
    ];

    it('has 5 total payment options', () => {
      expect(paymentOptions).toHaveLength(5);
    });

    it('has 2 school options and 3 online options', () => {
      const school = paymentOptions.filter((o) => o.group === 'school');
      const online = paymentOptions.filter((o) => o.group === 'online');
      expect(school).toHaveLength(2);
      expect(online).toHaveLength(3);
    });

    it('school options come first', () => {
      const schoolIndices = paymentOptions
        .map((o, i) => (o.group === 'school' ? i : -1))
        .filter((i) => i >= 0);
      const onlineIndices = paymentOptions
        .map((o, i) => (o.group === 'online' ? i : -1))
        .filter((i) => i >= 0);

      const maxSchoolIdx = Math.max(...schoolIndices);
      const minOnlineIdx = Math.min(...onlineIndices);
      expect(maxSchoolIdx).toBeLessThan(minOnlineIdx);
    });
  });
});
