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

export interface CartItem {
  id: string;
  product_id: string;
  student_id: string;
  student_name: string;
  name: string;
  price: number;
  quantity: number;
  image_url: string;
}

interface CartItemDB {
  id: string;
  user_id: string;
  student_id: string;
  product_id: string;
  quantity: number;
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
              image_url: item.products.image_url || ''
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
    if (!user || !item.student_id) return;

    setError(null);
    
    // Optimistic update
    setItems((prevItems) => {
      const existingItem = prevItems.find(
        (i) => i.product_id === item.product_id && i.student_id === item.student_id
      );
      
      if (existingItem) {
        return prevItems.map((i) =>
          i.product_id === item.product_id && i.student_id === item.student_id
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
        .eq('student_id', item.student_id)
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
            student_id: item.student_id,
            product_id: item.product_id,
            quantity: item.quantity
          });
      }
    } catch (err) {
      console.error('Failed to save cart item:', err);
    }
  }, [user]);

  const updateQuantity = useCallback(async (productId: string, studentId: string, quantity: number) => {
    if (!user) return;

    setError(null);

    if (quantity <= 0) {
      setItems((prevItems) => prevItems.filter(
        (i) => !(i.product_id === productId && i.student_id === studentId)
      ));
      
      try {
        await supabase
          .from('cart_items')
          .delete()
          .eq('user_id', user.id)
          .eq('student_id', studentId)
          .eq('product_id', productId);
      } catch (err) {
        console.error('Failed to delete cart item:', err);
      }
    } else {
      setItems((prevItems) =>
        prevItems.map((i) =>
          i.product_id === productId && i.student_id === studentId 
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
          .eq('product_id', productId);
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

  // Checkout all students' orders with single payment
  const checkout = useCallback(async (
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

      // Group items by student
      const itemsByStudentId = currentItems.reduce((acc, item) => {
        if (!acc[item.student_id]) {
          acc[item.student_id] = [];
        }
        acc[item.student_id].push(item);
        return acc;
      }, {} as Record<string, CartItem[]>);

      const studentIds = Object.keys(itemsByStudentId);
      const results: Array<{ order_id?: string; student_id: string }> = [];

      // Create order for each student
      for (const studentId of studentIds) {
        const studentItems = itemsByStudentId[studentId];
        
        const orderData = {
          parent_id: user.id,
          student_id: studentId,
          client_order_id: crypto.randomUUID(),
          items: studentItems.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
            price_at_order: item.price
          })),
          payment_method: method || currentPaymentMethod,
          notes: orderNotes || currentNotes,
          scheduled_for: scheduledFor || formatDateLocal(new Date())
        };

        const result = await createOrder(orderData);
        results.push({ order_id: result?.order_id, student_id: studentId });
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