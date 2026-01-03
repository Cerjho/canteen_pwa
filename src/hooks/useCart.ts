import { useState, useCallback, useRef, useEffect } from 'react';
import { createOrder } from '../services/orders';
import { useAuth } from './useAuth';
import { supabase } from '../services/supabaseClient';
import type { PaymentMethod } from '../types';

// Helper to format date as YYYY-MM-DD in LOCAL timezone
function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface CartItem {
  id: string;
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  image_url: string;
}

interface CartItemDB {
  id: string;
  user_id: string;
  product_id: string;
  quantity: number;
  products: {
    id: string;
    name: string;
    price: number;
    image_url: string | null;
  };
}

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingCart, setIsLoadingCart] = useState(true);
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

  // Load cart from database on mount or user change
  useEffect(() => {
    async function loadCart() {
      if (!user) {
        setItems([]);
        setIsLoadingCart(false);
        return;
      }

      setIsLoadingCart(true);
      try {
        const { data, error: fetchError } = await supabase
          .from('cart_items')
          .select(`
            id,
            user_id,
            product_id,
            quantity,
            products (
              id,
              name,
              price,
              image_url
            )
          `)
          .eq('user_id', user.id);

        if (fetchError) {
          console.error('Failed to load cart:', fetchError);
          setItems([]);
        } else if (data) {
          const cartItems: CartItem[] = (data as unknown as CartItemDB[])
            .filter(item => item.products) // Filter out items with deleted products
            .map(item => ({
              id: item.id,
              product_id: item.product_id,
              name: item.products.name,
              price: item.products.price,
              quantity: item.quantity,
              image_url: item.products.image_url || ''
            }));
          setItems(cartItems);
        }
      } catch (err) {
        console.error('Failed to load cart:', err);
        setItems([]);
      } finally {
        setIsLoadingCart(false);
      }
    }

    loadCart();
  }, [user]);

  const addItem = useCallback(async (item: Omit<CartItem, 'id'>) => {
    if (!user) return;

    setError(null);
    
    // Optimistic update
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

    // Persist to database
    try {
      // Check if item already exists
      const { data: existing } = await supabase
        .from('cart_items')
        .select('id, quantity')
        .eq('user_id', user.id)
        .eq('product_id', item.product_id)
        .single();

      if (existing) {
        // Update quantity
        await supabase
          .from('cart_items')
          .update({ quantity: existing.quantity + item.quantity })
          .eq('id', existing.id);
      } else {
        // Insert new item
        await supabase
          .from('cart_items')
          .insert({
            user_id: user.id,
            product_id: item.product_id,
            quantity: item.quantity
          });
      }
    } catch (err) {
      console.error('Failed to save cart item:', err);
    }
  }, [user]);

  const updateQuantity = useCallback(async (productId: string, quantity: number) => {
    if (!user) return;

    setError(null);

    if (quantity <= 0) {
      // Optimistic delete
      setItems((prevItems) => prevItems.filter((i) => i.product_id !== productId));
      
      // Delete from database
      try {
        await supabase
          .from('cart_items')
          .delete()
          .eq('user_id', user.id)
          .eq('product_id', productId);
      } catch (err) {
        console.error('Failed to delete cart item:', err);
      }
    } else {
      // Optimistic update
      setItems((prevItems) =>
        prevItems.map((i) =>
          i.product_id === productId ? { ...i, quantity } : i
        )
      );

      // Update in database
      try {
        await supabase
          .from('cart_items')
          .update({ quantity })
          .eq('user_id', user.id)
          .eq('product_id', productId);
      } catch (err) {
        console.error('Failed to update cart item:', err);
      }
    }
  }, [user]);

  const clearCart = useCallback(async () => {
    setItems([]);
    setNotes('');
    setPaymentMethod('cash');
    setError(null);

    // Clear from database
    if (user) {
      try {
        await supabase
          .from('cart_items')
          .delete()
          .eq('user_id', user.id);
      } catch (err) {
        console.error('Failed to clear cart:', err);
      }
    }
  }, [user]);

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
        scheduled_for: scheduledFor || formatDateLocal(new Date())
      };

      const result = await createOrder(orderData);
      await clearCart();
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
    isLoadingCart,
    error,
    clearError: () => setError(null)
  };
}