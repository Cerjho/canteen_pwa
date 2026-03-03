// useCart Hook Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCart } from '../../../src/hooks/useCart';
import { getTodayLocal } from '../../../src/utils/dateUtils';

// Mock supabase client — each from() call returns a fresh self-referencing chain
// so vi.clearAllMocks() never breaks the mock structure.
vi.mock('../../../src/services/supabaseClient', () => {
  const createChain = () => {
    const terminalResult = { data: null, error: null };
    const listResult = { data: [], error: null };

    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    // Chain methods return the chain itself (for .eq().gte().order() etc.)
    ['eq', 'gte', 'match', 'select', 'update', 'delete'].forEach(m => {
      chain[m] = vi.fn(() => chain);
    });
    // Terminal methods return result objects
    chain.maybeSingle = vi.fn(() => terminalResult);
    chain.single = vi.fn(() => terminalResult);
    chain.order = vi.fn(() => listResult);
    chain.insert = vi.fn(() => terminalResult);
    chain.upsert = vi.fn(() => terminalResult);
    chain.in = vi.fn(() => terminalResult);
    return chain;
  };

  return {
    supabase: {
      from: vi.fn(() => createChain()),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
  };
});

// Mock useAuth — stable object reference to prevent infinite re-render loop
const mockUser = { id: 'test-user-123' };
vi.mock('../../../src/hooks/useAuth', () => ({
  useAuth: () => ({
    user: mockUser
  })
}));

// Mock createBatchOrder (the hook now uses batch order API)
const mockCreateBatchOrder = vi.fn();
vi.mock('../../../src/services/orders', () => ({
  createBatchOrder: (data: Record<string, unknown>) => mockCreateBatchOrder(data)
}));

// Mock payments service (imported by the hook)
vi.mock('../../../src/services/payments', () => ({
  createBatchCheckout: vi.fn()
}));

describe('useCart Hook', () => {
  // Use Asia/Manila timezone (same as the hook) to avoid CI failures
  // when UTC date differs from Manila date (UTC 16:00–23:59)
  const today = getTodayLocal();
  
  const mockProduct = {
    product_id: 'product-1',
    student_id: 'student-1',
    student_name: 'John Doe',
    name: 'Chicken Adobo',
    price: 65.00,
    quantity: 1,
    image_url: 'https://example.com/adobo.jpg',
    scheduled_for: today,
    meal_period: 'lunch' as const
  };

  // Helper: renders the hook and waits for the initial loadCart effect to settle.
  // This avoids race conditions between loadCart's setItems([]) and test actions.
  async function renderCartHook() {
    const hookResult = renderHook(() => useCart());
    await waitFor(() => {
      expect(hookResult.result.current.isLoadingCart).toBe(false);
    });
    return hookResult;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateBatchOrder.mockResolvedValue({
      success: true,
      order_ids: ['order-1'],
      orders: [{ order_id: 'order-1', client_order_id: 'client-1', total_amount: 65, status: 'pending', payment_status: 'awaiting_payment', payment_due_at: null }],
      total_amount: 65,
      message: 'Orders created successfully'
    });
  });

  describe('Initial State', () => {
    it('should start with empty cart', () => {
      const { result } = renderHook(() => useCart());

      expect(result.current.items).toEqual([]);
      expect(result.current.total).toBe(0);
      expect(result.current.notes).toBe('');
      expect(result.current.paymentMethod).toBe('cash');
    });
  });

  describe('addItem', () => {
    it('should add new item to cart', async () => {
      const { result } = await renderCartHook();

      await act(async () => {
        await result.current.addItem(mockProduct);
      });

      await waitFor(() => {
        expect(result.current.items).toHaveLength(1);
      });
      
      expect(result.current.items[0]).toMatchObject({
        product_id: 'product-1',
        name: 'Chicken Adobo',
        price: 65.00,
        quantity: 1
      });
    });

    it('should increment quantity for existing item', async () => {
      const { result } = await renderCartHook();

      await act(async () => {
        await result.current.addItem(mockProduct);
      });

      await act(async () => {
        await result.current.addItem(mockProduct);
      });

      await waitFor(() => {
        expect(result.current.items).toHaveLength(1);
      });
      expect(result.current.items[0].quantity).toBe(2);
    });

    it('should add multiple different items', async () => {
      const { result } = await renderCartHook();

      await act(async () => {
        await result.current.addItem(mockProduct);
      });

      await act(async () => {
        await result.current.addItem({
          ...mockProduct,
          product_id: 'product-2',
          name: 'Spaghetti',
          price: 55.00
        });
      });

      await waitFor(() => {
        expect(result.current.items).toHaveLength(2);
      });
    });

    it('should add quantity correctly', async () => {
      const { result } = await renderCartHook();

      await act(async () => {
        await result.current.addItem({ ...mockProduct, quantity: 3 });
      });

      await waitFor(() => {
        expect(result.current.items[0]?.quantity).toBe(3);
      });
    });
  });

  describe('updateQuantity', () => {
    it('should update item quantity', async () => {
      const { result } = await renderCartHook();

      await act(async () => {
        await result.current.addItem(mockProduct);
      });

      await waitFor(() => {
        expect(result.current.items).toHaveLength(1);
      });

      await act(async () => {
        await result.current.updateQuantity('product-1', 'student-1', today, 5);
      });

      await waitFor(() => {
        expect(result.current.items[0]?.quantity).toBe(5);
      });
    });

    it('should remove item when quantity is zero', async () => {
      const { result } = await renderCartHook();

      await act(async () => {
        await result.current.addItem(mockProduct);
      });

      await waitFor(() => {
        expect(result.current.items).toHaveLength(1);
      });

      await act(async () => {
        await result.current.updateQuantity('product-1', 'student-1', today, 0);
      });

      await waitFor(() => {
        expect(result.current.items).toHaveLength(0);
      });
    });

    it('should remove item when quantity is negative', async () => {
      const { result } = await renderCartHook();

      await act(async () => {
        await result.current.addItem(mockProduct);
      });

      await waitFor(() => {
        expect(result.current.items).toHaveLength(1);
      });

      await act(async () => {
        await result.current.updateQuantity('product-1', 'student-1', today, -1);
      });

      await waitFor(() => {
        expect(result.current.items).toHaveLength(0);
      });
    });
  });

  describe('clearCart', () => {
    it('should clear all items', async () => {
      const { result } = await renderCartHook();

      await act(async () => {
        await result.current.addItem(mockProduct);
        await result.current.addItem({
          ...mockProduct,
          product_id: 'product-2',
          name: 'Spaghetti',
          price: 55.00
        });
      });

      await waitFor(() => {
        expect(result.current.items.length).toBeGreaterThan(0);
      });

      await act(async () => {
        await result.current.clearCart();
      });

      await waitFor(() => {
        expect(result.current.items).toHaveLength(0);
      });
    });

    it('should reset notes', async () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.setNotes('Special instructions');
      });

      await act(async () => {
        await result.current.clearCart();
      });

      expect(result.current.notes).toBe('');
    });

    it('should reset payment method', async () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.setPaymentMethod('gcash');
      });

      await act(async () => {
        await result.current.clearCart();
      });

      expect(result.current.paymentMethod).toBe('cash');
    });
  });

  describe('total', () => {
    it('should calculate total correctly', async () => {
      const { result } = await renderCartHook();

      await act(async () => {
        await result.current.addItem({ ...mockProduct, quantity: 2 }); // 65 * 2 = 130
        await result.current.addItem({
          ...mockProduct,
          product_id: 'product-2',
          name: 'Spaghetti',
          price: 55.00,
          quantity: 1 // 55 * 1 = 55
        });
      });

      await waitFor(() => {
        expect(result.current.total).toBe(185);
      });
    });

    it('should return 0 for empty cart', () => {
      const { result } = renderHook(() => useCart());

      expect(result.current.total).toBe(0);
    });

    it('should update total when quantity changes', async () => {
      const { result } = await renderCartHook();

      await act(async () => {
        await result.current.addItem(mockProduct);
      });

      await waitFor(() => {
        expect(result.current.total).toBe(65);
      });

      await act(async () => {
        await result.current.updateQuantity('product-1', 'student-1', today, 3);
      });

      await waitFor(() => {
        expect(result.current.total).toBe(195);
      });
    });
  });

  describe('notes', () => {
    it('should set notes', () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.setNotes('No onions please');
      });

      expect(result.current.notes).toBe('No onions please');
    });
  });

  describe('paymentMethod', () => {
    it('should set payment method', () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.setPaymentMethod('gcash');
      });

      expect(result.current.paymentMethod).toBe('gcash');
    });

    it('should accept different payment methods', () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.setPaymentMethod('balance');
      });

      expect(result.current.paymentMethod).toBe('balance');
    });
  });

  describe('checkout', () => {
    it('should create order with cart items', async () => {
      const { result } = await renderCartHook();

      await act(async () => {
        await result.current.addItem(mockProduct);
      });

      await waitFor(() => {
        expect(result.current.items.length).toBeGreaterThan(0);
      });

      await act(async () => {
        await result.current.checkout('cash', '');
      });

      expect(mockCreateBatchOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          parent_id: 'test-user-123',
          orders: expect.arrayContaining([
            expect.objectContaining({
              student_id: 'student-1',
              items: expect.arrayContaining([
                expect.objectContaining({
                  product_id: 'product-1',
                  quantity: 1,
                  price_at_order: 65.00
                })
              ])
            })
          ])
        })
      );
    });

    it('should clear cart after successful checkout', async () => {
      const { result } = await renderCartHook();

      await act(async () => {
        await result.current.addItem(mockProduct);
      });

      await waitFor(() => {
        expect(result.current.items.length).toBeGreaterThan(0);
      });

      await act(async () => {
        await result.current.checkout('cash', '');
      });

      await waitFor(() => {
        expect(result.current.items).toHaveLength(0);
      });
    });

    it('should throw error for empty cart', async () => {
      const { result } = renderHook(() => useCart());

      await expect(
        act(async () => {
          await result.current.checkout('cash', '');
        })
      ).rejects.toThrow('Your cart is empty.');
    });

    it('should use provided payment method', async () => {
      const { result } = await renderCartHook();

      await act(async () => {
        await result.current.addItem(mockProduct);
      });

      await waitFor(() => {
        expect(result.current.items.length).toBeGreaterThan(0);
      });

      await act(async () => {
        await result.current.checkout('balance', '');
      });

      expect(mockCreateBatchOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_method: 'balance'
        })
      );
    });

    it('should include notes in order', async () => {
      const { result } = await renderCartHook();

      await act(async () => {
        await result.current.addItem(mockProduct);
      });

      await waitFor(() => {
        expect(result.current.items.length).toBeGreaterThan(0);
      });

      await act(async () => {
        await result.current.checkout('cash', 'Extra rice please');
      });

      expect(mockCreateBatchOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          notes: 'Extra rice please'
        })
      );
    });

    it('should include scheduled date in order', async () => {
      const { result } = await renderCartHook();

      await act(async () => {
        await result.current.addItem(mockProduct);
      });

      await waitFor(() => {
        expect(result.current.items.length).toBeGreaterThan(0);
      });

      await act(async () => {
        await result.current.checkout('cash', '');
      });

      expect(mockCreateBatchOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          orders: expect.arrayContaining([
            expect.objectContaining({
              scheduled_for: today
            })
          ])
        })
      );
    });

    it('should return order result', async () => {
      mockCreateBatchOrder.mockResolvedValue({
        success: true,
        order_ids: ['new-order-id'],
        orders: [{ order_id: 'new-order-id', client_order_id: 'c-1', total_amount: 65, status: 'pending', payment_status: 'awaiting_payment', payment_due_at: null }],
        total_amount: 65,
        message: 'OK'
      });

      const { result } = await renderCartHook();

      await act(async () => {
        await result.current.addItem(mockProduct);
      });

      await waitFor(() => {
        expect(result.current.items.length).toBeGreaterThan(0);
      });

      let orderResult;
      await act(async () => {
        orderResult = await result.current.checkout('cash', '');
      });

      expect(orderResult).toMatchObject({
        orders: expect.arrayContaining([
          expect.objectContaining({ order_id: 'new-order-id' })
        ])
      });
    });
  });

  describe('BUG-020: Notes Handling', () => {
    it('empty string notes should not fall back to stale notes', async () => {
      const { result } = await renderCartHook();

      // Set hook-level notes to simulate stale notes from a previous session
      act(() => {
        result.current.setNotes('Old stale notes');
      });

      await act(async () => {
        await result.current.addItem(mockProduct);
      });

      await waitFor(() => {
        expect(result.current.items.length).toBeGreaterThan(0);
      });

      // Checkout with explicit empty string — should NOT fall back to 'Old stale notes'
      await act(async () => {
        await result.current.checkout('cash', '');
      });

      // The batch order should have been called with empty string notes, NOT 'Old stale notes'
      expect(mockCreateBatchOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          notes: ''
        })
      );
    });
  });

  describe('BUG-035: isDateInPast timezone handling', () => {
    it('rejects adding items for past dates using Asia/Manila timezone', async () => {
      const { result } = await renderCartHook();

      // Use a clearly past date
      await act(async () => {
        await result.current.addItem({
          ...mockProduct,
          scheduled_for: '2020-01-01'
        });
      });

      // Item should NOT be added — past date validation should prevent it
      // The hook sets an error for past dates
      expect(result.current.error).toBeTruthy();
    });

    it('allows adding items for today using Asia/Manila timezone', async () => {
      const { result } = await renderCartHook();

      await act(async () => {
        await result.current.addItem(mockProduct); // Uses 'today' as scheduled_for
      });

      await waitFor(() => {
        expect(result.current.items).toHaveLength(1);
      });
    });
  });
});