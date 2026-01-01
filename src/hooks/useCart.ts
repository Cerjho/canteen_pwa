import { useState } from 'react';
import { createOrder } from '../services/orders';
import { useAuth } from './useAuth';
import type { PaymentMethod } from '../types';

interface CartItem {
  id: string;
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  image_url: string;
}

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const { user } = useAuth();

  const addItem = (item: Omit<CartItem, 'id'>) => {
    setItems((prevItems) => {
      const existingItem = prevItems.find((i) => i.product_id === item.product_id);
      
      if (existingItem) {
        return prevItems.map((i) =>
          i.product_id === item.product_id
            ? { ...i, quantity: i.quantity + item.quantity }
            : i
        );
      }
      
      return [...prevItems, { ...item, id: crypto.randomUUID() }];
    });
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      setItems((prevItems) => prevItems.filter((i) => i.product_id !== productId));
    } else {
      setItems((prevItems) =>
        prevItems.map((i) =>
          i.product_id === productId ? { ...i, quantity } : i
        )
      );
    }
  };

  const clearCart = () => {
    setItems([]);
    setNotes('');
    setPaymentMethod('cash');
  };

  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const checkout = async (childId: string, method?: PaymentMethod, orderNotes?: string, scheduledFor?: string) => {
    if (!user) throw new Error('User not authenticated');
    if (items.length === 0) throw new Error('Cart is empty');

    const orderData = {
      parent_id: user.id,
      child_id: childId,
      client_order_id: crypto.randomUUID(),
      items: items.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        price_at_order: item.price
      })),
      payment_method: method || paymentMethod,
      notes: orderNotes || notes,
      scheduled_for: scheduledFor || new Date().toISOString().split('T')[0]
    };

    const result = await createOrder(orderData);
    clearCart();
    return result;
  };

  return {
    items,
    addItem,
    updateQuantity,
    clearCart,
    total,
    checkout,
    notes,
    setNotes,
    paymentMethod,
    setPaymentMethod
  };
}