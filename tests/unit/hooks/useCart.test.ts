// useCart Hook Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCart } from '../../../src/hooks/useCart';

// Mock supabase client
const mockInsert = vi.fn().mockReturnValue({ data: null, error: null });
const _mockUpdate = vi.fn().mockReturnValue({ data: null, error: null });
const _mockDelete = vi.fn().mockReturnValue({ data: null, error: null });
const mockUpsert = vi.fn().mockReturnValue({ data: null, error: null });
const mockSelect = vi.fn().mockReturnValue({
  eq: vi.fn().mockReturnValue({
    gte: vi.fn().mockReturnValue({
      order: vi.fn().mockReturnValue({ data: [], error: null })
    }),
    maybeSingle: vi.fn().mockReturnValue({ data: null, error: null }),
    single: vi.fn().mockReturnValue({ data: null, error: null })
  })
});

vi.mock('../../../src/services/supabaseClient', () => ({
  supabase: {
    from: vi.fn((_table: string) => {
      // Reset mocks for chain
      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({ data: [], error: null })
          }),
          maybeSingle: vi.fn().mockReturnValue({ data: null, error: null }),
          single: vi.fn().mockReturnValue({ data: null, error: null })
        })
      });
      return {
        select: mockSelect,
        insert: mockInsert,
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ data: null, error: null })
          })
        }),
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ data: null, error: null })
          })
        }),
        upsert: mockUpsert
      };
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null })
  }
}));

// Mock useAuth
vi.mock('../../../src/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-user-123' }
  })
}));

// Mock createOrder
const mockCreateOrder = vi.fn();
vi.mock('../../../src/services/orders', () => ({
  createOrder: (data: Record<string, unknown>) => mockCreateOrder(data)
}));

describe('useCart Hook', () => {
  const today = new Date().toISOString().split('T')[0];
  
  const mockProduct = {
    product_id: 'product-1',
    student_id: 'student-1',
    student_name: 'John Doe',
    name: 'Chicken Adobo',
    price: 65.00,
    quantity: 1,
    image_url: 'https://example.com/adobo.jpg',
    scheduled_for: today
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOrder.mockResolvedValue({ id: 'order-1' });
    // Reset supabase mock to return empty cart
    mockSelect.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({ data: [], error: null })
        }),
        maybeSingle: vi.fn().mockReturnValue({ data: null, error: null }),
        single: vi.fn().mockReturnValue({ data: null, error: null }),
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockReturnValue({ data: null, error: null })
          })
        })
      })
    });
    mockInsert.mockReturnValue({ data: null, error: null });
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
      const { result } = renderHook(() => useCart());

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
      const { result } = renderHook(() => useCart());

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
      const { result } = renderHook(() => useCart());

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
      const { result } = renderHook(() => useCart());

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
      const { result } = renderHook(() => useCart());

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
      const { result } = renderHook(() => useCart());

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
      const { result } = renderHook(() => useCart());

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
      const { result } = renderHook(() => useCart());

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
      const { result } = renderHook(() => useCart());

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
      const { result } = renderHook(() => useCart());

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
      const { result } = renderHook(() => useCart());

      await act(async () => {
        await result.current.addItem(mockProduct);
      });

      await waitFor(() => {
        expect(result.current.items.length).toBeGreaterThan(0);
      });

      await act(async () => {
        await result.current.checkout('cash', '');
      });

      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          parent_id: 'test-user-123',
          student_id: 'student-1',
          items: expect.arrayContaining([
            expect.objectContaining({
              product_id: 'product-1',
              quantity: 1,
              price_at_order: 65.00
            })
          ])
        })
      );
    });

    it('should clear cart after successful checkout', async () => {
      const { result } = renderHook(() => useCart());

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
      ).rejects.toThrow('Cart is empty');
    });

    it('should use provided payment method', async () => {
      const { result } = renderHook(() => useCart());

      await act(async () => {
        await result.current.addItem(mockProduct);
      });

      await waitFor(() => {
        expect(result.current.items.length).toBeGreaterThan(0);
      });

      await act(async () => {
        await result.current.checkout('balance', '');
      });

      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_method: 'balance'
        })
      );
    });

    it('should include notes in order', async () => {
      const { result } = renderHook(() => useCart());

      await act(async () => {
        await result.current.addItem(mockProduct);
      });

      await waitFor(() => {
        expect(result.current.items.length).toBeGreaterThan(0);
      });

      await act(async () => {
        await result.current.checkout('cash', 'Extra rice please');
      });

      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          notes: 'Extra rice please'
        })
      );
    });

    it('should include scheduled date in order', async () => {
      const { result } = renderHook(() => useCart());

      await act(async () => {
        await result.current.addItem(mockProduct);
      });

      await waitFor(() => {
        expect(result.current.items.length).toBeGreaterThan(0);
      });

      await act(async () => {
        await result.current.checkout('cash', '');
      });

      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduled_for: today
        })
      );
    });

    it('should return order result', async () => {
      mockCreateOrder.mockResolvedValue({ order_id: 'new-order-id', status: 'pending' });

      const { result } = renderHook(() => useCart());

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
        success: true,
        orders: expect.arrayContaining([
          expect.objectContaining({ order_id: 'new-order-id' })
        ])
      });
    });
  });
});