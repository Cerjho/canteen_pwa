import { useState, useCallback, useRef, useEffect } from 'react';
import { createOrder } from '../services/orders';
import { useAuth } from './useAuth';
import { supabase } from '../services/supabaseClient';
import type { PaymentMethod } from '../types';

export interface CartItem {
  id: string;
  product_id: string;
  student_id: string;
  student_name: string;
  name: string;
  price: number;
  quantity: number;
  image_url: string;
  scheduled_for: string; // YYYY-MM-DD format
}

interface CartItemDB {
  id: string;
  user_id: string;
  student_id: string;
  product_id: string;
  quantity: number;
  scheduled_for: string;
  products: {
    id: string;
    name: string;
    price: number;
    image_url: string | null;
  };
  students: {
    id: string;
    first_name: string;
    last_name: string;
  };
}

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [selectedStudentId, setSelectedStudentIdState] = useState<string | null>(null);
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
  const selectedStudentIdRef = useRef(selectedStudentId);
  
  // Keep refs in sync with state
  itemsRef.current = items;
  notesRef.current = notes;
  paymentMethodRef.current = paymentMethod;
  selectedStudentIdRef.current = selectedStudentId;

  // Load all cart items for all students on mount
  useEffect(() => {
    async function loadCart() {
      if (!user) {
        setItems([]);
        setSelectedStudentIdState(null);
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
              student_id,
              product_id,
              quantity,
              scheduled_for,
              products (
                id,
                name,
                price,
                image_url
              ),
              students (
                id,
                first_name,
                last_name
              )
            `)
            .eq('user_id', user.id),
          supabase
            .from('cart_state')
            .select('student_id')
            .eq('user_id', user.id)
            .maybeSingle()
        ]);

        if (itemsResult.error) {
          console.error('Failed to load cart items:', itemsResult.error);
          setItems([]);
        } else if (itemsResult.data) {
          const cartItems: CartItem[] = (itemsResult.data as unknown as CartItemDB[])
            .filter(item => item.products && item.students)
            .map(item => ({
              id: item.id,
              product_id: item.product_id,
              student_id: item.student_id,
              student_name: `${item.students.first_name} ${item.students.last_name}`,
              name: item.products.name,
              price: item.products.price,
              quantity: item.quantity,
              image_url: item.products.image_url || '',
              scheduled_for: item.scheduled_for
            }));
          setItems(cartItems);
        }

        // Load selected student
        if (stateResult.data?.student_id) {
          setSelectedStudentIdState(stateResult.data.student_id);
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

  // Save selected student to database
  const setSelectedStudentId = useCallback(async (studentId: string | null) => {
    setSelectedStudentIdState(studentId);
    
    if (!user) return;
    
    try {
      await supabase
        .from('cart_state')
        .upsert({
          user_id: user.id,
          student_id: studentId,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
    } catch (err) {
      console.error('Failed to save cart state:', err);
    }
  }, [user]);

  const addItem = useCallback(async (item: Omit<CartItem, 'id'>) => {
    if (!user || !item.student_id || !item.scheduled_for) return;

    setError(null);
    
    // Optimistic update - match by product, student AND scheduled_for date
    setItems((prevItems) => {
      const existingItem = prevItems.find(
        (i) => i.product_id === item.product_id && 
               i.student_id === item.student_id && 
               i.scheduled_for === item.scheduled_for
      );
      
      if (existingItem) {
        return prevItems.map((i) =>
          i.product_id === item.product_id && 
          i.student_id === item.student_id && 
          i.scheduled_for === item.scheduled_for
            ? { ...i, quantity: i.quantity + item.quantity }
            : i
        );
      }
      
      return [...prevItems, { ...item, id: crypto.randomUUID() }];
    });

    // Persist to database - match by product, student AND scheduled_for
    try {
      const { data: existing } = await supabase
        .from('cart_items')
        .select('id, quantity')
        .eq('user_id', user.id)
        .eq('student_id', item.student_id)
        .eq('product_id', item.product_id)
        .eq('scheduled_for', item.scheduled_for)
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
            student_id: item.student_id,
            product_id: item.product_id,
            quantity: item.quantity,
            scheduled_for: item.scheduled_for
          });
      }
    } catch (err) {
      console.error('Failed to save cart item:', err);
    }
  }, [user]);

  const updateQuantity = useCallback(async (productId: string, studentId: string, scheduledFor: string, quantity: number) => {
    if (!user) return;

    setError(null);

    if (quantity <= 0) {
      setItems((prevItems) => prevItems.filter(
        (i) => !(i.product_id === productId && i.student_id === studentId && i.scheduled_for === scheduledFor)
      ));
      
      try {
        await supabase
          .from('cart_items')
          .delete()
          .eq('user_id', user.id)
          .eq('student_id', studentId)
          .eq('product_id', productId)
          .eq('scheduled_for', scheduledFor);
      } catch (err) {
        console.error('Failed to delete cart item:', err);
      }
    } else {
      setItems((prevItems) =>
        prevItems.map((i) =>
          i.product_id === productId && i.student_id === studentId && i.scheduled_for === scheduledFor
            ? { ...i, quantity } 
            : i
        )
      );

      try {
        await supabase
          .from('cart_items')
          .update({ quantity })
          .eq('user_id', user.id)
          .eq('student_id', studentId)
          .eq('product_id', productId)
          .eq('scheduled_for', scheduledFor);
      } catch (err) {
        console.error('Failed to update cart item:', err);
      }
    }
  }, [user]);

  // Clear entire cart (all students)
  const clearCart = useCallback(async () => {
    setItems([]);
    setNotes('');
    setPaymentMethod('cash');
    setError(null);

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

  // Get items grouped by student
  const itemsByStudent = items.reduce((acc, item) => {
    if (!acc[item.student_id]) {
      acc[item.student_id] = {
        student_name: item.student_name,
        items: []
      };
    }
    acc[item.student_id].items.push(item);
    return acc;
  }, {} as Record<string, { student_name: string; items: CartItem[] }>);

  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  // Checkout all students' orders - creates separate order per student+date combination
  const checkout = useCallback(async (
    method?: PaymentMethod, 
    orderNotes?: string
  ) => {
    if (!user) throw new Error('User not authenticated');
    
    setIsLoading(true);
    setError(null);

    try {
      const currentItems = itemsRef.current;
      const currentPaymentMethod = paymentMethodRef.current;
      const currentNotes = notesRef.current;

      if (currentItems.length === 0) throw new Error('Cart is empty');

      // Group items by student AND scheduled_for date
      const itemsByStudentAndDate = currentItems.reduce((acc, item) => {
        const key = `${item.student_id}_${item.scheduled_for}`;
        if (!acc[key]) {
          acc[key] = {
            student_id: item.student_id,
            scheduled_for: item.scheduled_for,
            items: []
          };
        }
        acc[key].items.push(item);
        return acc;
      }, {} as Record<string, { student_id: string; scheduled_for: string; items: CartItem[] }>);

      const results: Array<{ order_id?: string; student_id: string; scheduled_for: string }> = [];

      // Create order for each student+date combination
      for (const group of Object.values(itemsByStudentAndDate)) {
        const orderData = {
          parent_id: user.id,
          student_id: group.student_id,
          client_order_id: crypto.randomUUID(),
          items: group.items.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
            price_at_order: item.price
          })),
          payment_method: method || currentPaymentMethod,
          notes: orderNotes || currentNotes,
          scheduled_for: group.scheduled_for
        };

        const result = await createOrder(orderData);
        results.push({ order_id: result?.order_id, student_id: group.student_id, scheduled_for: group.scheduled_for });
      }

      await clearCart();
      return { orders: results, total: currentItems.reduce((sum, item) => sum + item.price * item.quantity, 0) };
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
    itemsByStudent,
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