import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createOrder } from '../services/orders';
import { useAuth } from './useAuth';
import { supabase } from '../services/supabaseClient';
import type { PaymentMethod } from '../types';
import { format, parseISO, isToday, isBefore, startOfDay } from 'date-fns';

// =====================================================
// TYPES
// =====================================================

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

// Grouped structure for display
export interface StudentCartGroup {
  student_id: string;
  student_name: string;
  items: CartItem[];
  subtotal: number;
}

export interface DateCartGroup {
  date: string; // YYYY-MM-DD
  displayDate: string; // Formatted for UI (e.g., "Mon, Jan 5")
  isToday: boolean;
  students: StudentCartGroup[];
  subtotal: number;
  itemCount: number;
}

export interface CartSummary {
  totalAmount: number;
  totalItems: number;
  dateCount: number;
  studentCount: number;
  orderCount: number; // Number of orders that will be created (student x date combinations)
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTodayLocal(): string {
  return formatDateLocal(new Date());
}

function formatDisplayDate(dateStr: string): string {
  try {
    const date = parseISO(dateStr);
    if (isToday(date)) return 'Today';
    return format(date, 'EEE, MMM d');
  } catch {
    return dateStr;
  }
}

function isDateInPast(dateStr: string): boolean {
  try {
    const date = parseISO(dateStr);
    const today = startOfDay(new Date());
    return isBefore(date, today);
  } catch {
    return false;
  }
}

// =====================================================
// MAIN HOOK
// =====================================================

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [selectedStudentId, setSelectedStudentIdState] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingCart, setIsLoadingCart] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  
  // Refs for accessing current state in callbacks
  const itemsRef = useRef(items);
  const notesRef = useRef(notes);
  const paymentMethodRef = useRef(paymentMethod);
  
  // Keep refs in sync
  useEffect(() => {
    itemsRef.current = items;
    notesRef.current = notes;
    paymentMethodRef.current = paymentMethod;
  }, [items, notes, paymentMethod]);

  // =====================================================
  // LOAD CART FROM DATABASE
  // =====================================================
  
  const loadCart = useCallback(async () => {
    if (!user) {
      setItems([]);
      setSelectedStudentIdState(null);
      setIsLoadingCart(false);
      return;
    }

    setIsLoadingCart(true);
    try {
      const today = getTodayLocal();
      
      // Load cart items and state in parallel
      // Only load items for today and future dates
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
          .eq('user_id', user.id)
          .gte('scheduled_for', today)
          .order('scheduled_for', { ascending: true }),
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

      // Cleanup past cart items in background (don't wait)
      supabase.rpc('cleanup_past_cart_items').then(({ error }) => {
        if (error) console.warn('Failed to cleanup past cart items:', error);
      });

    } catch (err) {
      console.error('Failed to load cart:', err);
      setItems([]);
    } finally {
      setIsLoadingCart(false);
    }
  }, [user]);

  // Load cart on mount and when user changes
  useEffect(() => {
    loadCart();
  }, [loadCart]);

  // =====================================================
  // COMPUTED VALUES - GROUPINGS
  // =====================================================

  // Group items by date, then by student - for multi-day cart display
  const itemsByDateAndStudent = useMemo((): DateCartGroup[] => {
    const dateMap = new Map<string, Map<string, CartItem[]>>();
    
    // Group items
    items.forEach(item => {
      if (!dateMap.has(item.scheduled_for)) {
        dateMap.set(item.scheduled_for, new Map());
      }
      const studentMap = dateMap.get(item.scheduled_for);
      if (studentMap) {
        if (!studentMap.has(item.student_id)) {
          studentMap.set(item.student_id, []);
        }
        const studentItems = studentMap.get(item.student_id);
        if (studentItems) {
          studentItems.push(item);
        }
      }
    });

    // Convert to array structure, sorted by date
    const result: DateCartGroup[] = [];
    
    const sortedDates = Array.from(dateMap.keys()).sort();
    
    for (const dateStr of sortedDates) {
      const studentMap = dateMap.get(dateStr);
      if (!studentMap) continue;
      const students: StudentCartGroup[] = [];
      let dateSubtotal = 0;
      let dateItemCount = 0;
      
      studentMap.forEach((studentItems, studentId) => {
        const subtotal = studentItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const itemCount = studentItems.reduce((sum, item) => sum + item.quantity, 0);
        dateSubtotal += subtotal;
        dateItemCount += itemCount;
        
        students.push({
          student_id: studentId,
          student_name: studentItems[0]?.student_name || 'Unknown',
          items: studentItems,
          subtotal
        });
      });
      
      // Sort students alphabetically
      students.sort((a, b) => a.student_name.localeCompare(b.student_name));
      
      result.push({
        date: dateStr,
        displayDate: formatDisplayDate(dateStr),
        isToday: isToday(parseISO(dateStr)),
        students,
        subtotal: dateSubtotal,
        itemCount: dateItemCount
      });
    }
    
    return result;
  }, [items]);

  // Legacy grouping by student only (for backwards compatibility)
  const itemsByStudent = useMemo(() => {
    return items.reduce((acc, item) => {
      if (!acc[item.student_id]) {
        acc[item.student_id] = {
          student_name: item.student_name,
          items: []
        };
      }
      acc[item.student_id].items.push(item);
      return acc;
    }, {} as Record<string, { student_name: string; items: CartItem[] }>);
  }, [items]);

  // Cart summary statistics
  const summary = useMemo((): CartSummary => {
    const uniqueDates = new Set(items.map(i => i.scheduled_for));
    const uniqueStudents = new Set(items.map(i => i.student_id));
    const orderCombinations = new Set(items.map(i => `${i.student_id}_${i.scheduled_for}`));
    
    return {
      totalAmount: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
      totalItems: items.reduce((sum, item) => sum + item.quantity, 0),
      dateCount: uniqueDates.size,
      studentCount: uniqueStudents.size,
      orderCount: orderCombinations.size
    };
  }, [items]);

  const total = summary.totalAmount;

  // Get items for a specific date
  const getItemsForDate = useCallback((dateStr: string): CartItem[] => {
    return items.filter(item => item.scheduled_for === dateStr);
  }, [items]);

  // Get items for a specific student
  const getItemsForStudent = useCallback((studentId: string): CartItem[] => {
    return items.filter(item => item.student_id === studentId);
  }, [items]);

  // Get items for a specific student on a specific date
  const getItemsForStudentOnDate = useCallback((studentId: string, dateStr: string): CartItem[] => {
    return items.filter(item => item.student_id === studentId && item.scheduled_for === dateStr);
  }, [items]);

  // =====================================================
  // CART OPERATIONS
  // =====================================================

  // Set selected student (persisted to DB)
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

  // Add item to cart
  const addItem = useCallback(async (item: Omit<CartItem, 'id'>) => {
    if (!user || !item.student_id || !item.scheduled_for) {
      setError('Missing required fields');
      return;
    }

    // Validate date is not in past
    if (isDateInPast(item.scheduled_for)) {
      setError('Cannot add items for past dates');
      return;
    }

    setError(null);
    
    // Optimistic update
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

    // Persist to database
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
        const { error } = await supabase
          .from('cart_items')
          .update({ quantity: existing.quantity + item.quantity })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('cart_items')
          .insert({
            user_id: user.id,
            student_id: item.student_id,
            product_id: item.product_id,
            quantity: item.quantity,
            scheduled_for: item.scheduled_for
          });
        if (error) throw error;
      }
    } catch (err) {
      console.error('Failed to save cart item:', err);
      // Revert optimistic update on error
      await loadCart();
      const message = err instanceof Error ? err.message : 'Failed to add item';
      setError(message);
    }
  }, [user, loadCart]);

  // Update item quantity
  const updateQuantity = useCallback(async (
    productId: string, 
    studentId: string, 
    scheduledFor: string, 
    quantity: number
  ) => {
    if (!user) return;

    setError(null);

    if (quantity <= 0) {
      // Remove item
      setItems((prevItems) => prevItems.filter(
        (i) => !(i.product_id === productId && i.student_id === studentId && i.scheduled_for === scheduledFor)
      ));
      
      try {
        const { error } = await supabase
          .from('cart_items')
          .delete()
          .eq('user_id', user.id)
          .eq('student_id', studentId)
          .eq('product_id', productId)
          .eq('scheduled_for', scheduledFor);
        if (error) throw error;
      } catch (err) {
        console.error('Failed to delete cart item:', err);
        await loadCart();
      }
    } else {
      // Update quantity
      setItems((prevItems) =>
        prevItems.map((i) =>
          i.product_id === productId && i.student_id === studentId && i.scheduled_for === scheduledFor
            ? { ...i, quantity } 
            : i
        )
      );

      try {
        const { error } = await supabase
          .from('cart_items')
          .update({ quantity })
          .eq('user_id', user.id)
          .eq('student_id', studentId)
          .eq('product_id', productId)
          .eq('scheduled_for', scheduledFor);
        if (error) throw error;
      } catch (err) {
        console.error('Failed to update cart item:', err);
        await loadCart();
      }
    }
  }, [user, loadCart]);

  // Clear entire cart
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

  // Clear cart for a specific date
  const clearDate = useCallback(async (dateStr: string) => {
    if (!user) return;

    setError(null);
    
    // Optimistic update
    setItems((prevItems) => prevItems.filter(i => i.scheduled_for !== dateStr));

    try {
      const { error } = await supabase
        .from('cart_items')
        .delete()
        .eq('user_id', user.id)
        .eq('scheduled_for', dateStr);
      if (error) throw error;
    } catch (err) {
      console.error('Failed to clear date:', err);
      await loadCart();
    }
  }, [user, loadCart]);

  // Clear cart for a specific student on a specific date
  const clearStudentOnDate = useCallback(async (studentId: string, dateStr: string) => {
    if (!user) return;

    setError(null);
    
    // Optimistic update
    setItems((prevItems) => prevItems.filter(
      i => !(i.student_id === studentId && i.scheduled_for === dateStr)
    ));

    try {
      const { error } = await supabase
        .from('cart_items')
        .delete()
        .eq('user_id', user.id)
        .eq('student_id', studentId)
        .eq('scheduled_for', dateStr);
      if (error) throw error;
    } catch (err) {
      console.error('Failed to clear student on date:', err);
      await loadCart();
    }
  }, [user, loadCart]);

  // Copy items from one date to another
  const copyDateItems = useCallback(async (fromDate: string, toDate: string) => {
    if (!user) return;

    // Validate target date
    if (isDateInPast(toDate)) {
      setError('Cannot copy items to past dates');
      return;
    }

    setError(null);
    
    const itemsToCopy = items.filter(i => i.scheduled_for === fromDate);
    if (itemsToCopy.length === 0) {
      setError('No items to copy');
      return;
    }

    // Optimistic update
    const newItems: CartItem[] = itemsToCopy.map(item => ({
      ...item,
      id: crypto.randomUUID(),
      scheduled_for: toDate
    }));

    setItems((prevItems) => {
      // Merge with existing items on target date
      const result = [...prevItems];
      
      for (const newItem of newItems) {
        const existingIdx = result.findIndex(
          i => i.product_id === newItem.product_id && 
               i.student_id === newItem.student_id && 
               i.scheduled_for === newItem.scheduled_for
        );
        
        if (existingIdx >= 0) {
          result[existingIdx] = {
            ...result[existingIdx],
            quantity: result[existingIdx].quantity + newItem.quantity
          };
        } else {
          result.push(newItem);
        }
      }
      
      return result;
    });

    // Persist to database
    try {
      for (const item of itemsToCopy) {
        const { data: existing } = await supabase
          .from('cart_items')
          .select('id, quantity')
          .eq('user_id', user.id)
          .eq('student_id', item.student_id)
          .eq('product_id', item.product_id)
          .eq('scheduled_for', toDate)
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
              scheduled_for: toDate
            });
        }
      }
    } catch (err) {
      console.error('Failed to copy items:', err);
      await loadCart();
      const message = err instanceof Error ? err.message : 'Failed to copy items';
      setError(message);
    }
  }, [user, items, loadCart]);

  // Copy student items from one date to another
  const copyStudentItems = useCallback(async (
    studentId: string, 
    fromDate: string, 
    toDate: string
  ) => {
    if (!user) return;

    if (isDateInPast(toDate)) {
      setError('Cannot copy items to past dates');
      return;
    }

    setError(null);
    
    const itemsToCopy = items.filter(
      i => i.student_id === studentId && i.scheduled_for === fromDate
    );
    
    if (itemsToCopy.length === 0) {
      setError('No items to copy');
      return;
    }

    // Optimistic update
    setItems((prevItems) => {
      const result = [...prevItems];
      
      for (const item of itemsToCopy) {
        const existingIdx = result.findIndex(
          i => i.product_id === item.product_id && 
               i.student_id === item.student_id && 
               i.scheduled_for === toDate
        );
        
        if (existingIdx >= 0) {
          result[existingIdx] = {
            ...result[existingIdx],
            quantity: result[existingIdx].quantity + item.quantity
          };
        } else {
          result.push({
            ...item,
            id: crypto.randomUUID(),
            scheduled_for: toDate
          });
        }
      }
      
      return result;
    });

    // Persist to database
    try {
      for (const item of itemsToCopy) {
        const { data: existing } = await supabase
          .from('cart_items')
          .select('id, quantity')
          .eq('user_id', user.id)
          .eq('student_id', item.student_id)
          .eq('product_id', item.product_id)
          .eq('scheduled_for', toDate)
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
              scheduled_for: toDate
            });
        }
      }
    } catch (err) {
      console.error('Failed to copy student items:', err);
      await loadCart();
    }
  }, [user, items, loadCart]);

  // =====================================================
  // CHECKOUT
  // =====================================================

  const checkout = useCallback(async (
    method?: PaymentMethod, 
    orderNotes?: string,
    selectedDates?: string[] // Optional: only checkout specific dates
  ) => {
    if (!user) throw new Error('User not authenticated');
    
    setIsLoading(true);
    setError(null);

    try {
      let currentItems = itemsRef.current;
      
      // Filter by selected dates if provided
      if (selectedDates && selectedDates.length > 0) {
        currentItems = currentItems.filter(item => selectedDates.includes(item.scheduled_for));
      }

      if (currentItems.length === 0) throw new Error('Cart is empty');

      const currentPaymentMethod = paymentMethodRef.current;
      const currentNotes = notesRef.current;

      // Group items by student AND scheduled_for date
      const groups = new Map<string, { student_id: string; scheduled_for: string; items: CartItem[] }>();
      
      for (const item of currentItems) {
        const key = `${item.student_id}_${item.scheduled_for}`;
        if (!groups.has(key)) {
          groups.set(key, {
            student_id: item.student_id,
            scheduled_for: item.scheduled_for,
            items: []
          });
        }
        const group = groups.get(key);
        if (group) {
          group.items.push(item);
        }
      }

      const results: Array<{ order_id?: string; student_id: string; scheduled_for: string; error?: string }> = [];

      // Create order for each student+date combination
      for (const group of groups.values()) {
        try {
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
          results.push({ 
            order_id: result?.order_id, 
            student_id: group.student_id, 
            scheduled_for: group.scheduled_for 
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Failed to create order';
          results.push({ 
            student_id: group.student_id, 
            scheduled_for: group.scheduled_for,
            error: errorMsg
          });
        }
      }

      // Check if any orders failed
      const failedOrders = results.filter(r => r.error);
      if (failedOrders.length > 0 && failedOrders.length === results.length) {
        throw new Error(failedOrders[0].error || 'All orders failed');
      }

      // Clear only successfully ordered items
      const successfulKeys = new Set(
        results.filter(r => !r.error).map(r => `${r.student_id}_${r.scheduled_for}`)
      );
      
      // Remove successful items from local state
      setItems(prev => prev.filter(item => {
        const key = `${item.student_id}_${item.scheduled_for}`;
        return !successfulKeys.has(key);
      }));

      // Delete from database
      for (const result of results.filter(r => !r.error)) {
        await supabase
          .from('cart_items')
          .delete()
          .eq('user_id', user.id)
          .eq('student_id', result.student_id)
          .eq('scheduled_for', result.scheduled_for);
      }

      // If all items were checked out, reset notes and payment method
      if (itemsRef.current.length === 0) {
        setNotes('');
        setPaymentMethod('cash');
      }

      return { 
        orders: results, 
        total: currentItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
        successCount: results.filter(r => !r.error).length,
        failCount: failedOrders.length
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Checkout failed';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // Checkout only items for a specific date
  const checkoutDate = useCallback(async (
    dateStr: string,
    method?: PaymentMethod,
    orderNotes?: string
  ) => {
    return checkout(method, orderNotes, [dateStr]);
  }, [checkout]);

  // =====================================================
  // RETURN
  // =====================================================

  return {
    // State
    items,
    isLoading,
    isLoadingCart,
    error,
    clearError: () => setError(null),
    
    // Computed values
    total,
    summary,
    itemsByStudent, // Legacy - for backwards compatibility
    itemsByDateAndStudent, // New - for multi-day cart display
    
    // Getters
    getItemsForDate,
    getItemsForStudent,
    getItemsForStudentOnDate,
    
    // Cart operations
    addItem,
    updateQuantity,
    clearCart,
    clearDate,
    clearStudentOnDate,
    copyDateItems,
    copyStudentItems,
    loadCart, // Expose for manual refresh
    
    // Checkout
    checkout,
    checkoutDate,
    
    // Notes & payment
    notes,
    setNotes,
    paymentMethod,
    setPaymentMethod,
    
    // Selected student
    selectedStudentId,
    setSelectedStudentId
  };
}
