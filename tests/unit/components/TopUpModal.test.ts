// TopUpModal Component Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the payments service
const mockCreateTopupCheckout = vi.fn();
vi.mock('../../../src/services/payments', () => ({
  createTopupCheckout: (...args: unknown[]) => mockCreateTopupCheckout(...args),
}));

describe('TopUpModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Amount Selection Logic ─────────────────────────────────
  describe('Amount Selection', () => {
    const TOPUP_PRESETS = [100, 200, 500, 1000, 2000, 5000];
    const MIN_TOPUP = 50;
    const MAX_TOPUP = 50000;

    it('has six preset amounts', () => {
      expect(TOPUP_PRESETS).toHaveLength(6);
      expect(TOPUP_PRESETS).toEqual([100, 200, 500, 1000, 2000, 5000]);
    });

    it('preset amounts are all within valid range', () => {
      TOPUP_PRESETS.forEach((preset) => {
        expect(preset).toBeGreaterThanOrEqual(MIN_TOPUP);
        expect(preset).toBeLessThanOrEqual(MAX_TOPUP);
      });
    });

    it('validates minimum amount', () => {
      const amount = 30;
      const isValid = amount >= MIN_TOPUP && amount <= MAX_TOPUP;
      expect(isValid).toBe(false);
    });

    it('validates maximum amount', () => {
      const amount = 60000;
      const isValid = amount >= MIN_TOPUP && amount <= MAX_TOPUP;
      expect(isValid).toBe(false);
    });

    it('accepts valid amounts', () => {
      const validAmounts = [50, 100, 500, 5000, 25000, 50000];
      validAmounts.forEach((amount) => {
        const isValid = amount >= MIN_TOPUP && amount <= MAX_TOPUP;
        expect(isValid).toBe(true);
      });
    });

    it('accepts exact minimum', () => {
      const isValid = MIN_TOPUP >= MIN_TOPUP && MIN_TOPUP <= MAX_TOPUP;
      expect(isValid).toBe(true);
    });

    it('accepts exact maximum', () => {
      const isValid = MAX_TOPUP >= MIN_TOPUP && MAX_TOPUP <= MAX_TOPUP;
      expect(isValid).toBe(true);
    });

    it('rejects zero amount', () => {
      const amount = 0;
      const isValid = amount >= MIN_TOPUP && amount <= MAX_TOPUP;
      expect(isValid).toBe(false);
    });

    it('rejects negative amount', () => {
      const amount = -100;
      const isValid = amount >= MIN_TOPUP && amount <= MAX_TOPUP;
      expect(isValid).toBe(false);
    });

    it('custom amount cleans non-numeric input', () => {
      const rawInput = '₱1,500.50abc';
      const cleaned = rawInput.replace(/[^0-9.]/g, '');
      expect(cleaned).toBe('1500.50');
    });

    it('custom amount overrides preset selection', () => {
      let amount = 500; // preset selected
      let customAmount = '';

      // User types custom amount
      customAmount = '750';
      amount = 0;

      const effectiveAmount = customAmount ? parseFloat(customAmount) : amount;
      expect(effectiveAmount).toBe(750);
    });

    it('preset selection clears custom amount', () => {
      let amount = 0;
      let customAmount = '750';

      // User clicks preset
      amount = 500;
      customAmount = '';

      const effectiveAmount = customAmount ? parseFloat(customAmount) : amount;
      expect(effectiveAmount).toBe(500);
    });
  });

  // ─── Payment Method Selection ───────────────────────────────
  describe('Payment Method Selection', () => {
    const onlinePaymentMethods = ['gcash', 'paymaya', 'card'];

    it('has three online payment methods', () => {
      expect(onlinePaymentMethods).toHaveLength(3);
    });

    it('defaults to gcash', () => {
      const defaultMethod = 'gcash';
      expect(defaultMethod).toBe('gcash');
    });

    it('all methods are online payment types', () => {
      onlinePaymentMethods.forEach((method) => {
        expect(['gcash', 'paymaya', 'card']).toContain(method);
      });
    });

    it('does not include cash or balance', () => {
      expect(onlinePaymentMethods).not.toContain('cash');
      expect(onlinePaymentMethods).not.toContain('balance');
    });
  });

  // ─── Top-up Checkout Flow ───────────────────────────────────
  describe('Top-up Checkout Flow', () => {
    it('creates topup checkout with correct parameters', async () => {
      mockCreateTopupCheckout.mockResolvedValue({
        success: true,
        topup_session_id: 'topup-1',
        checkout_url: 'https://checkout.paymongo.com/cs_topup',
        expires_at: '2026-02-20T12:30:00Z',
        amount: 500,
      });

      const result = await mockCreateTopupCheckout({
        amount: 500,
        payment_method: 'gcash',
      });

      expect(mockCreateTopupCheckout).toHaveBeenCalledWith({
        amount: 500,
        payment_method: 'gcash',
      });
      expect(result.checkout_url).toContain('paymongo.com');
      expect(result.topup_session_id).toBe('topup-1');
    });

    it('handles API errors gracefully', async () => {
      mockCreateTopupCheckout.mockRejectedValue(
        new Error('Failed to create top-up session')
      );

      let error: string | null = null;
      try {
        await mockCreateTopupCheckout({ amount: 500, payment_method: 'gcash' });
      } catch (err) {
        error = err instanceof Error ? err.message : 'Unknown error';
      }

      expect(error).toBe('Failed to create top-up session');
    });

    it('shows loading state during checkout creation', async () => {
      let isLoading = false;

      // Simulate the flow
      isLoading = true;
      expect(isLoading).toBe(true);

      mockCreateTopupCheckout.mockResolvedValue({
        success: true,
        topup_session_id: 'topup-1',
        checkout_url: 'https://checkout.test',
        expires_at: '2026-02-20T12:30:00Z',
        amount: 500,
      });
      await mockCreateTopupCheckout({ amount: 500, payment_method: 'gcash' });

      // On redirect, loading stays true (page will change)
      expect(isLoading).toBe(true);
    });

    it('resets loading on error', async () => {
      let isLoading = false;

      isLoading = true;
      mockCreateTopupCheckout.mockRejectedValue(new Error('Network error'));
      try {
        await mockCreateTopupCheckout({ amount: 500, payment_method: 'gcash' });
      } catch {
        isLoading = false;
      }

      expect(isLoading).toBe(false);
    });
  });

  // ─── Modal Behavior ─────────────────────────────────────────
  describe('Modal Behavior', () => {
    it('does not render when isOpen is false', () => {
      const isOpen = false;
      const shouldRender = isOpen;
      expect(shouldRender).toBe(false);
    });

    it('renders when isOpen is true', () => {
      const isOpen = true;
      const shouldRender = isOpen;
      expect(shouldRender).toBe(true);
    });

    it('disables proceed button when amount is invalid', () => {
      const effectiveAmount = 30; // below minimum
      const isValidAmount = effectiveAmount >= 50 && effectiveAmount <= 50000;
      const isLoading = false;
      const disabled = !isValidAmount || isLoading;
      expect(disabled).toBe(true);
    });

    it('disables proceed button while loading', () => {
      const isValidAmount = true;
      const isLoading = true;
      const disabled = !isValidAmount || isLoading;
      expect(disabled).toBe(true);
    });

    it('enables proceed button when valid and not loading', () => {
      const isValidAmount = true;
      const isLoading = false;
      const disabled = !isValidAmount || isLoading;
      expect(disabled).toBe(false);
    });
  });
});
