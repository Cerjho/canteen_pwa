/**
 * useCart Multi-Day Cart Tests
 * 
 * Tests for the multi-day cart pure logic without database calls.
 * These tests focus on the local state management and computed values.
 */
import { describe, it, expect } from 'vitest';
import { format, addDays } from 'date-fns';

// Test utilities for multi-day cart logic
describe('Multi-Day Cart Logic', () => {
  const today = format(new Date(), 'yyyy-MM-dd');
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
  const dayAfter = format(addDays(new Date(), 2), 'yyyy-MM-dd');

  const mockStudentA = {
    id: 'student-a',
    first_name: 'Alice',
    last_name: 'Smith',
    name: 'Alice Smith'
  };

  const mockStudentB = {
    id: 'student-b',
    first_name: 'Bob',
    last_name: 'Jones',
    name: 'Bob Jones'
  };

  // Helper to create cart items
  const createCartItem = (overrides: Partial<{
    id: string;
    product_id: string;
    student_id: string;
    student_name: string;
    name: string;
    price: number;
    quantity: number;
    image_url: string;
    scheduled_for: string;
  }> = {}) => ({
    id: `cart-item-${Math.random().toString(36).substring(7)}`,
    product_id: 'product-1',
    student_id: mockStudentA.id,
    student_name: mockStudentA.name,
    name: 'Chicken Adobo',
    price: 65.00,
    quantity: 1,
    image_url: 'https://example.com/adobo.jpg',
    scheduled_for: today,
    ...overrides
  });

  // Pure function to group items by date and student
  function groupItemsByDateAndStudent(items: ReturnType<typeof createCartItem>[]) {
    const dateMap = new Map<string, Map<string, ReturnType<typeof createCartItem>[]>>();
    
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

    const result: Array<{
      date: string;
      students: Array<{
        student_id: string;
        student_name: string;
        items: ReturnType<typeof createCartItem>[];
        subtotal: number;
      }>;
      subtotal: number;
      itemCount: number;
    }> = [];
    
    const sortedDates = Array.from(dateMap.keys()).sort();
    
    for (const dateStr of sortedDates) {
      const studentMap = dateMap.get(dateStr);
      if (!studentMap) continue;
      
      const students: Array<{
        student_id: string;
        student_name: string;
        items: ReturnType<typeof createCartItem>[];
        subtotal: number;
      }> = [];
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
      
      result.push({
        date: dateStr,
        students,
        subtotal: dateSubtotal,
        itemCount: dateItemCount
      });
    }
    
    return result;
  }

  // Pure function to calculate summary
  function calculateSummary(items: ReturnType<typeof createCartItem>[]) {
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
  }

  describe('groupItemsByDateAndStudent', () => {
    it('should return empty array for empty items', () => {
      const result = groupItemsByDateAndStudent([]);
      expect(result).toEqual([]);
    });

    it('should group items by date', () => {
      const items = [
        createCartItem({ scheduled_for: today }),
        createCartItem({ scheduled_for: tomorrow, product_id: 'product-2' })
      ];

      const result = groupItemsByDateAndStudent(items);
      
      expect(result).toHaveLength(2);
      expect(result[0].date).toBe(today);
      expect(result[1].date).toBe(tomorrow);
    });

    it('should sort dates chronologically', () => {
      const items = [
        createCartItem({ scheduled_for: dayAfter }),
        createCartItem({ scheduled_for: today, product_id: 'product-2' }),
        createCartItem({ scheduled_for: tomorrow, product_id: 'product-3' })
      ];

      const result = groupItemsByDateAndStudent(items);
      
      expect(result[0].date).toBe(today);
      expect(result[1].date).toBe(tomorrow);
      expect(result[2].date).toBe(dayAfter);
    });

    it('should group students within each date', () => {
      const items = [
        createCartItem({ 
          student_id: mockStudentA.id,
          student_name: mockStudentA.name,
          scheduled_for: today 
        }),
        createCartItem({ 
          student_id: mockStudentB.id,
          student_name: mockStudentB.name,
          scheduled_for: today,
          product_id: 'product-2'
        })
      ];

      const result = groupItemsByDateAndStudent(items);
      
      expect(result).toHaveLength(1);
      expect(result[0].students).toHaveLength(2);
    });

    it('should calculate subtotals per date', () => {
      const items = [
        createCartItem({ 
          scheduled_for: today, 
          price: 50,
          quantity: 2 
        }),
        createCartItem({ 
          scheduled_for: tomorrow,
          product_id: 'product-2',
          price: 30,
          quantity: 3
        })
      ];

      const result = groupItemsByDateAndStudent(items);
      
      expect(result[0].subtotal).toBe(100); // 50 * 2
      expect(result[1].subtotal).toBe(90);  // 30 * 3
    });

    it('should calculate item counts per date', () => {
      const items = [
        createCartItem({ 
          scheduled_for: today, 
          quantity: 2 
        }),
        createCartItem({ 
          scheduled_for: today,
          product_id: 'product-2',
          quantity: 3
        })
      ];

      const result = groupItemsByDateAndStudent(items);
      
      expect(result[0].itemCount).toBe(5); // 2 + 3
    });

    it('should calculate subtotals per student', () => {
      const items = [
        createCartItem({ 
          student_id: mockStudentA.id,
          student_name: mockStudentA.name,
          scheduled_for: today,
          price: 50,
          quantity: 2 
        }),
        createCartItem({ 
          student_id: mockStudentB.id,
          student_name: mockStudentB.name,
          scheduled_for: today,
          product_id: 'product-2',
          price: 30,
          quantity: 1
        })
      ];

      const result = groupItemsByDateAndStudent(items);
      
      const studentA = result[0].students.find(s => s.student_id === mockStudentA.id);
      const studentB = result[0].students.find(s => s.student_id === mockStudentB.id);
      
      expect(studentA?.subtotal).toBe(100); // 50 * 2
      expect(studentB?.subtotal).toBe(30);  // 30 * 1
    });
  });

  describe('calculateSummary', () => {
    it('should return zeros for empty cart', () => {
      const result = calculateSummary([]);
      
      expect(result.totalAmount).toBe(0);
      expect(result.totalItems).toBe(0);
      expect(result.dateCount).toBe(0);
      expect(result.studentCount).toBe(0);
      expect(result.orderCount).toBe(0);
    });

    it('should calculate total amount', () => {
      const items = [
        createCartItem({ price: 50, quantity: 2 }),
        createCartItem({ price: 30, quantity: 1, product_id: 'product-2' })
      ];

      const result = calculateSummary(items);
      
      expect(result.totalAmount).toBe(130); // (50*2) + (30*1)
    });

    it('should count total items', () => {
      const items = [
        createCartItem({ quantity: 2 }),
        createCartItem({ quantity: 3, product_id: 'product-2' })
      ];

      const result = calculateSummary(items);
      
      expect(result.totalItems).toBe(5);
    });

    it('should count unique dates', () => {
      const items = [
        createCartItem({ scheduled_for: today }),
        createCartItem({ scheduled_for: today, product_id: 'product-2' }),
        createCartItem({ scheduled_for: tomorrow, product_id: 'product-3' })
      ];

      const result = calculateSummary(items);
      
      expect(result.dateCount).toBe(2);
    });

    it('should count unique students', () => {
      const items = [
        createCartItem({ student_id: mockStudentA.id }),
        createCartItem({ student_id: mockStudentA.id, product_id: 'product-2' }),
        createCartItem({ student_id: mockStudentB.id, product_id: 'product-3' })
      ];

      const result = calculateSummary(items);
      
      expect(result.studentCount).toBe(2);
    });

    it('should count order combinations (student x date)', () => {
      const items = [
        // Student A, today
        createCartItem({ 
          student_id: mockStudentA.id, 
          scheduled_for: today 
        }),
        // Student B, today
        createCartItem({ 
          student_id: mockStudentB.id, 
          scheduled_for: today,
          product_id: 'product-2'
        }),
        // Student A, tomorrow
        createCartItem({ 
          student_id: mockStudentA.id, 
          scheduled_for: tomorrow,
          product_id: 'product-3'
        })
      ];

      const result = calculateSummary(items);
      
      expect(result.orderCount).toBe(3); // (A,today), (B,today), (A,tomorrow)
    });
  });

  describe('Item filtering by date', () => {
    it('should filter items for specific date', () => {
      const items = [
        createCartItem({ scheduled_for: today }),
        createCartItem({ scheduled_for: today, product_id: 'product-2' }),
        createCartItem({ scheduled_for: tomorrow, product_id: 'product-3' })
      ];

      const todayItems = items.filter(i => i.scheduled_for === today);
      const tomorrowItems = items.filter(i => i.scheduled_for === tomorrow);

      expect(todayItems).toHaveLength(2);
      expect(tomorrowItems).toHaveLength(1);
    });
  });

  describe('Item filtering by student and date', () => {
    it('should filter items for specific student on specific date', () => {
      const items = [
        // Student A, today
        createCartItem({ 
          student_id: mockStudentA.id, 
          scheduled_for: today 
        }),
        // Student B, today
        createCartItem({ 
          student_id: mockStudentB.id, 
          scheduled_for: today,
          product_id: 'product-2'
        }),
        // Student A, tomorrow
        createCartItem({ 
          student_id: mockStudentA.id, 
          scheduled_for: tomorrow,
          product_id: 'product-3'
        })
      ];

      const studentATodayItems = items.filter(
        i => i.student_id === mockStudentA.id && i.scheduled_for === today
      );

      expect(studentATodayItems).toHaveLength(1);
    });
  });

  describe('Clear date logic', () => {
    it('should remove all items for a specific date', () => {
      const items = [
        createCartItem({ scheduled_for: today }),
        createCartItem({ scheduled_for: today, product_id: 'product-2' }),
        createCartItem({ scheduled_for: tomorrow, product_id: 'product-3' })
      ];

      const afterClear = items.filter(i => i.scheduled_for !== today);

      expect(afterClear).toHaveLength(1);
      expect(afterClear[0].scheduled_for).toBe(tomorrow);
    });
  });

  describe('Clear student on date logic', () => {
    it('should remove items for specific student on specific date', () => {
      const items = [
        createCartItem({ 
          student_id: mockStudentA.id, 
          scheduled_for: today 
        }),
        createCartItem({ 
          student_id: mockStudentB.id, 
          scheduled_for: today,
          product_id: 'product-2'
        }),
        createCartItem({ 
          student_id: mockStudentA.id, 
          scheduled_for: tomorrow,
          product_id: 'product-3'
        })
      ];

      const afterClear = items.filter(
        i => !(i.student_id === mockStudentA.id && i.scheduled_for === today)
      );

      expect(afterClear).toHaveLength(2);
      expect(afterClear.some(i => i.student_id === mockStudentA.id && i.scheduled_for === today)).toBe(false);
    });
  });

  describe('Copy date items logic', () => {
    it('should create new items for target date', () => {
      const items = [
        createCartItem({ scheduled_for: today }),
        createCartItem({ scheduled_for: today, product_id: 'product-2' })
      ];

      const itemsToCopy = items.filter(i => i.scheduled_for === today);
      const newItems = itemsToCopy.map(item => ({
        ...item,
        id: `new-${item.id}`,
        scheduled_for: tomorrow
      }));

      const allItems = [...items, ...newItems];

      expect(allItems).toHaveLength(4);
      expect(allItems.filter(i => i.scheduled_for === tomorrow)).toHaveLength(2);
    });

    it('should merge quantities when copying to date with existing items', () => {
      const items = [
        createCartItem({ 
          product_id: 'product-1',
          student_id: mockStudentA.id,
          scheduled_for: today,
          quantity: 2
        }),
        createCartItem({ 
          product_id: 'product-1',
          student_id: mockStudentA.id,
          scheduled_for: tomorrow,
          quantity: 1
        })
      ];

      // Simulate merging
      const itemsToCopy = items.filter(i => i.scheduled_for === today);
      const result = [...items];

      for (const copyItem of itemsToCopy) {
        const existingIdx = result.findIndex(
          i => i.product_id === copyItem.product_id && 
               i.student_id === copyItem.student_id && 
               i.scheduled_for === tomorrow
        );

        if (existingIdx >= 0) {
          result[existingIdx] = {
            ...result[existingIdx],
            quantity: result[existingIdx].quantity + copyItem.quantity
          };
        } else {
          result.push({
            ...copyItem,
            id: `new-${copyItem.id}`,
            scheduled_for: tomorrow
          });
        }
      }

      const tomorrowItems = result.filter(i => i.scheduled_for === tomorrow);
      expect(tomorrowItems).toHaveLength(1);
      expect(tomorrowItems[0].quantity).toBe(3); // 1 + 2
    });
  });

  describe('Checkout with date filtering', () => {
    it('should filter items by selected dates', () => {
      const items = [
        createCartItem({ scheduled_for: today }),
        createCartItem({ scheduled_for: tomorrow, product_id: 'product-2' }),
        createCartItem({ scheduled_for: dayAfter, product_id: 'product-3' })
      ];

      const selectedDates = [today, tomorrow];
      const itemsToCheckout = items.filter(i => selectedDates.includes(i.scheduled_for));

      expect(itemsToCheckout).toHaveLength(2);
      expect(itemsToCheckout.map(i => i.scheduled_for)).toContain(today);
      expect(itemsToCheckout.map(i => i.scheduled_for)).toContain(tomorrow);
      expect(itemsToCheckout.map(i => i.scheduled_for)).not.toContain(dayAfter);
    });

    it('should include all items when no date filter', () => {
      const items = [
        createCartItem({ scheduled_for: today }),
        createCartItem({ scheduled_for: tomorrow, product_id: 'product-2' })
      ];

      const selectedDates: string[] = [];
      const itemsToCheckout = selectedDates.length > 0
        ? items.filter(i => selectedDates.includes(i.scheduled_for))
        : items;

      expect(itemsToCheckout).toHaveLength(2);
    });
  });

  describe('Update quantity with date consideration', () => {
    it('should update quantity only for matching date', () => {
      const items = [
        createCartItem({ 
          product_id: 'product-1',
          student_id: mockStudentA.id,
          scheduled_for: today,
          quantity: 1
        }),
        createCartItem({ 
          product_id: 'product-1',
          student_id: mockStudentA.id,
          scheduled_for: tomorrow,
          quantity: 1
        })
      ];

      // Update today's quantity
      const updated = items.map(i =>
        i.product_id === 'product-1' && 
        i.student_id === mockStudentA.id && 
        i.scheduled_for === today
          ? { ...i, quantity: 5 }
          : i
      );

      expect(updated[0].quantity).toBe(5);  // today - updated
      expect(updated[1].quantity).toBe(1);  // tomorrow - unchanged
    });

    it('should remove item for specific date when quantity is 0', () => {
      const items = [
        createCartItem({ 
          product_id: 'product-1',
          student_id: mockStudentA.id,
          scheduled_for: today,
          quantity: 1
        }),
        createCartItem({ 
          product_id: 'product-1',
          student_id: mockStudentA.id,
          scheduled_for: tomorrow,
          quantity: 1
        })
      ];

      // Remove today's item (quantity 0)
      const filtered = items.filter(
        i => !(i.product_id === 'product-1' && 
               i.student_id === mockStudentA.id && 
               i.scheduled_for === today)
      );

      expect(filtered).toHaveLength(1);
      expect(filtered[0].scheduled_for).toBe(tomorrow);
    });
  });

  describe('Item uniqueness key', () => {
    it('should identify items by product_id, student_id, and scheduled_for', () => {
      const items = [
        createCartItem({ 
          product_id: 'product-1',
          student_id: mockStudentA.id,
          scheduled_for: today
        }),
        createCartItem({ 
          product_id: 'product-1',
          student_id: mockStudentA.id,
          scheduled_for: tomorrow
        }),
        createCartItem({ 
          product_id: 'product-1',
          student_id: mockStudentB.id,
          scheduled_for: today
        }),
        createCartItem({ 
          product_id: 'product-2',
          student_id: mockStudentA.id,
          scheduled_for: today
        })
      ];

      // All 4 items should be unique
      const keys = items.map(i => `${i.product_id}_${i.student_id}_${i.scheduled_for}`);
      const uniqueKeys = new Set(keys);
      
      expect(uniqueKeys.size).toBe(4);
    });

    it('should merge items with same key', () => {
      const items = [
        createCartItem({ 
          product_id: 'product-1',
          student_id: mockStudentA.id,
          scheduled_for: today,
          quantity: 1
        })
      ];

      const newItem = createCartItem({ 
        product_id: 'product-1',
        student_id: mockStudentA.id,
        scheduled_for: today,
        quantity: 2
      });

      const existingIdx = items.findIndex(
        i => i.product_id === newItem.product_id && 
             i.student_id === newItem.student_id && 
             i.scheduled_for === newItem.scheduled_for
      );

      expect(existingIdx).toBe(0);
      
      // Merge
      items[existingIdx].quantity += newItem.quantity;
      expect(items[0].quantity).toBe(3);
    });
  });
});
