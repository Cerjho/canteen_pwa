import { useState, useCallback, useRef } from 'react';
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  
  // Use refs to access current state in callbacks without stale closure issues
  const itemsRef = useRef(items);
  const notesRef = useRef(notes);
  const paymentMethodRef = useRef(paymentMethod);
  
  // Keep refs in sync with state
  itemsRef.current = items;
  notesRef.current = notes;
  paymentMethodRef.current = paymentMethod;

  const addItem = useCallback((item: Omit<CartItem, 'id'>) => {
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
    setError(null);
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    if (quantity <= 0) {
      setItems((prevItems) => prevItems.filter((i) => i.product_id !== productId));
    } else {
      setItems((prevItems) =>
        prevItems.map((i) =>
          i.product_id === productId ? { ...i, quantity } : i
        )
      );
    }
    setError(null);
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setNotes('');
    setPaymentMethod('cash');
    setError(null);
  }, []);

  // Calculate total using functional approach to get latest items
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const checkout = useCallback(async (
    studentId: string, 
    method?: PaymentMethod, 
    orderNotes?: string, 
    scheduledFor?: string
  ) => {
    if (!user) throw new Error('User not authenticated');
    
    setIsLoading(true);
    setError(null);

    try {
      // Read from refs to get current values without stale closure
      const currentItems = itemsRef.current;
      const currentPaymentMethod = paymentMethodRef.current;
      const currentNotes = notesRef.current;

      if (currentItems.length === 0) throw new Error('Cart is empty');

      const orderData = {
        parent_id: user.id,
        student_id: studentId,
        client_order_id: crypto.randomUUID(),
        items: currentItems.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
          price_at_order: item.price
        })),
        payment_method: method || currentPaymentMethod,
        notes: orderNotes || currentNotes,
        scheduled_for: scheduledFor || new Date().toISOString().split('T')[0]
      };

      const result = await createOrder(orderData);
      clearCart();
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Checkout failed';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [user, clearCart]); // Only stable dependencies - refs handle current state

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
    setPaymentMethod,
    isLoading,
    error,
    clearError: () => setError(null)
  };
}