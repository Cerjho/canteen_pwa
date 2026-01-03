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

interface CartStateDB {
  user_id: string;
  student_id: string | null;
  notes: string | null;
  payment_method: PaymentMethod | null;
}

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [selectedStudentId, setSelectedStudentIdState] = useState<string | null>(null);
  const [notes, setNotesState] = useState('');
  const [paymentMethod, setPaymentMethodState] = useState<PaymentMethod>('cash');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingCart, setIsLoadingCart] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  
  // Use refs to access current state in callbacks without stale closure issues
  const itemsRef = useRef(items);
  const notesRef = useRef(notes);
  const paymentMethodRef = useRef(paymentMethod);
  const selectedStudentIdRef = useRef(selectedStudentId);
  
  // Keep refs in sync with state
  itemsRef.current = items;
  notesRef.current = notes;
  paymentMethodRef.current = paymentMethod;
  selectedStudentIdRef.current = selectedStudentId;

  // Load cart items and state from database on mount or user change
  useEffect(() => {
    async function loadCart() {
      if (!user) {
        setItems([]);
        setSelectedStudentIdState(null);
        setNotesState('');
        setPaymentMethodState('cash');
        setIsLoadingCart(false);
        return;
      }

      setIsLoadingCart(true);
      try {
        // Load cart items and state in parallel
        const [itemsResult, stateResult] = await Promise.all([
          supabase
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
            .eq('user_id', user.id),
          supabase
            .from('cart_state')
            .select('user_id, student_id, notes, payment_method')
            .eq('user_id', user.id)
            .maybeSingle()
        ]);

        if (itemsResult.error) {
          console.error('Failed to load cart items:', itemsResult.error);
          setItems([]);
        } else if (itemsResult.data) {
          const cartItems: CartItem[] = (itemsResult.data as unknown as CartItemDB[])
            .filter(item => item.products)
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

        // Load cart state
        if (!stateResult.error && stateResult.data) {
          const state = stateResult.data as CartStateDB;
          if (state.student_id) setSelectedStudentIdState(state.student_id);
          if (state.notes) setNotesState(state.notes);
          if (state.payment_method) setPaymentMethodState(state.payment_method);
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

  // Save cart state to database
  const saveCartState = useCallback(async (updates: Partial<{ student_id: string | null; notes: string; payment_method: PaymentMethod }>) => {
    if (!user) return;
    
    try {
      const { error } = await supabase
        .from('cart_state')
        .upsert({
          user_id: user.id,
          ...updates,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
      
      if (error) console.error('Failed to save cart state:', error);
    } catch (err) {
      console.error('Failed to save cart state:', err);
    }
  }, [user]);

  // Wrapped setters that also persist to database
  const setSelectedStudentId = useCallback((studentId: string | null) => {
    setSelectedStudentIdState(studentId);
    saveCartState({ student_id: studentId });
  }, [saveCartState]);

  const setNotes = useCallback((newNotes: string) => {
    setNotesState(newNotes);
    // Debounce notes saving - don't save on every keystroke
  }, []);

  const setPaymentMethod = useCallback((method: PaymentMethod) => {
    setPaymentMethodState(method);
    saveCartState({ payment_method: method });
  }, [saveCartState]);

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
      const { data: existing } = await supabase
        .from('cart_items')
        .select('id, quantity')
        .eq('user_id', user.id)
        .eq('product_id', item.product_id)
        .single();

      if (existing) {
        await supabase
          .from('cart_items')
          .update({ quantity: existing.quantity + item.quantity })
          .eq('id', existing.id);
      } else {
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
      setItems((prevItems) => prevItems.filter((i) => i.product_id !== productId));
      
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
      setItems((prevItems) =>
        prevItems.map((i) =>
          i.product_id === productId ? { ...i, quantity } : i
        )
      );

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
    setNotesState('');
    setPaymentMethodState('cash');
    // Don't clear student selection - keep it for convenience
    setError(null);

    if (user) {
      try {
        await Promise.all([
          supabase.from('cart_items').delete().eq('user_id', user.id),
          supabase.from('cart_state').update({ notes: '', payment_method: 'cash' }).eq('user_id', user.id)
        ]);
      } catch (err) {
        console.error('Failed to clear cart:', err);
      }
    }
  }, [user]);

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
  }, [user, clearCart]);

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
    selectedStudentId,
    setSelectedStudentId,
    isLoading,
    isLoadingCart,
    error,
    clearError: () => setError(null)
  };
}