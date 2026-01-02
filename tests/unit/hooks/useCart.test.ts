// useCart Hook Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCart } from '../../../src/hooks/useCart';

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
  const mockProduct = {
    product_id: 'product-1',
    name: 'Chicken Adobo',
    price: 65.00,
    quantity: 1,
    image_url: 'https://example.com/adobo.jpg'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOrder.mockResolvedValue({ id: 'order-1' });
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
    it('should add new item to cart', () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.addItem(mockProduct);
      });

      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0]).toMatchObject({
        product_id: 'product-1',
        name: 'Chicken Adobo',
        price: 65.00,
        quantity: 1
      });
    });

    it('should increment quantity for existing item', () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.addItem(mockProduct);
      });

      act(() => {
        result.current.addItem(mockProduct);
      });

      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0].quantity).toBe(2);
    });

    it('should add multiple different items', () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.addItem(mockProduct);
      });

      act(() => {
        result.current.addItem({
          product_id: 'product-2',
          name: 'Spaghetti',
          price: 55.00,
          quantity: 1,
          image_url: 'https://example.com/spaghetti.jpg'
        });
      });

      expect(result.current.items).toHaveLength(2);
    });

    it('should add quantity correctly', () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.addItem({ ...mockProduct, quantity: 3 });
      });

      expect(result.current.items[0].quantity).toBe(3);
    });
  });

  describe('updateQuantity', () => {
    it('should update item quantity', () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.addItem(mockProduct);
      });

      act(() => {
        result.current.updateQuantity('product-1', 5);
      });

      expect(result.current.items[0].quantity).toBe(5);
    });

    it('should remove item when quantity is zero', () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.addItem(mockProduct);
      });

      act(() => {
        result.current.updateQuantity('product-1', 0);
      });

      expect(result.current.items).toHaveLength(0);
    });

    it('should remove item when quantity is negative', () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.addItem(mockProduct);
      });

      act(() => {
        result.current.updateQuantity('product-1', -1);
      });

      expect(result.current.items).toHaveLength(0);
    });
  });

  describe('clearCart', () => {
    it('should clear all items', () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.addItem(mockProduct);
        result.current.addItem({
          product_id: 'product-2',
          name: 'Spaghetti',
          price: 55.00,
          quantity: 1,
          image_url: 'https://example.com/spaghetti.jpg'
        });
      });

      act(() => {
        result.current.clearCart();
      });

      expect(result.current.items).toHaveLength(0);
    });

    it('should reset notes', () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.setNotes('Special instructions');
      });

      act(() => {
        result.current.clearCart();
      });

      expect(result.current.notes).toBe('');
    });

    it('should reset payment method', () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.setPaymentMethod('gcash');
      });

      act(() => {
        result.current.clearCart();
      });

      expect(result.current.paymentMethod).toBe('cash');
    });
  });

  describe('total', () => {
    it('should calculate total correctly', () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.addItem({ ...mockProduct, quantity: 2 }); // 65 * 2 = 130
        result.current.addItem({
          product_id: 'product-2',
          name: 'Spaghetti',
          price: 55.00,
          quantity: 1, // 55 * 1 = 55
          image_url: 'https://example.com/spaghetti.jpg'
        });
      });

      expect(result.current.total).toBe(185);
    });

    it('should return 0 for empty cart', () => {
      const { result } = renderHook(() => useCart());

      expect(result.current.total).toBe(0);
    });

    it('should update total when quantity changes', () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.addItem(mockProduct);
      });

      expect(result.current.total).toBe(65);

      act(() => {
        result.current.updateQuantity('product-1', 3);
      });

      expect(result.current.total).toBe(195);
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

      act(() => {
        result.current.addItem(mockProduct);
      });

      await act(async () => {
        await result.current.checkout('child-1');
      });

      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          parent_id: 'test-user-123',
          student_id: 'child-1',
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

      act(() => {
        result.current.addItem(mockProduct);
      });

      await act(async () => {
        await result.current.checkout('child-1');
      });

      expect(result.current.items).toHaveLength(0);
    });

    it('should throw error for empty cart', async () => {
      const { result } = renderHook(() => useCart());

      await expect(
        act(async () => {
          await result.current.checkout('child-1');
        })
      ).rejects.toThrow('Cart is empty');
    });

    it('should use provided payment method', async () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.addItem(mockProduct);
      });

      await act(async () => {
        await result.current.checkout('child-1', 'gcash');
      });

      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_method: 'gcash'
        })
      );
    });

    it('should include notes in order', async () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.addItem(mockProduct);
        result.current.setNotes('Extra rice please');
      });

      await act(async () => {
        await result.current.checkout('child-1');
      });

      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          notes: 'Extra rice please'
        })
      );
    });

    it('should include scheduled date in order', async () => {
      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.addItem(mockProduct);
      });

      await act(async () => {
        await result.current.checkout('child-1', 'cash', '', '2024-01-15');
      });

      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduled_for: '2024-01-15'
        })
      );
    });

    it('should return order result', async () => {
      mockCreateOrder.mockResolvedValue({ id: 'new-order-id', status: 'pending' });

      const { result } = renderHook(() => useCart());

      act(() => {
        result.current.addItem(mockProduct);
      });

      let orderResult;
      await act(async () => {
        orderResult = await result.current.checkout('child-1');
      });

      expect(orderResult).toEqual({ id: 'new-order-id', status: 'pending' });
    });
  });
});
