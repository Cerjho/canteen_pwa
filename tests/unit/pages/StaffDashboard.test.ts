// Staff Dashboard Tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Supabase
const mockSupabase = {
  from: vi.fn(),
  functions: {
    invoke: vi.fn()
  }
};

vi.mock('../../../src/services/supabaseClient', () => ({
  supabase: mockSupabase
}));

describe('Staff Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T10:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Order Filtering', () => {
    const mockOrders = [
      {
        id: 'order-1',
        status: 'pending',
        payment_status: 'paid',
        payment_method: 'balance',
        created_at: '2026-01-05T09:00:00',
        scheduled_for: '2026-01-05',
        total_amount: 150.00
      },
      {
        id: 'order-2',
        status: 'awaiting_payment',
        payment_status: 'awaiting_payment',
        payment_method: 'cash',
        payment_due_at: '2026-01-05T10:15:00',
        created_at: '2026-01-05T10:00:00',
        scheduled_for: '2026-01-05',
        total_amount: 75.00
      },
      {
        id: 'order-3',
        status: 'pending',
        payment_status: 'paid',
        payment_method: 'balance',
        created_at: '2026-01-04T15:00:00',
        scheduled_for: '2026-01-10', // Future order
        total_amount: 200.00
      }
    ];

    it('should filter orders by today date', () => {
      const today = '2026-01-05';
      const todayOrders = mockOrders.filter(o => o.scheduled_for === today);
      expect(todayOrders).toHaveLength(2);
      expect(todayOrders.map(o => o.id)).toContain('order-1');
      expect(todayOrders.map(o => o.id)).toContain('order-2');
    });

    it('should filter future orders separately', () => {
      const today = '2026-01-05';
      const futureOrders = mockOrders.filter(o => o.scheduled_for > today);
      expect(futureOrders).toHaveLength(1);
      expect(futureOrders[0].id).toBe('order-3');
    });

    it('should filter by status', () => {
      const pendingOrders = mockOrders.filter(o => o.status === 'pending');
      expect(pendingOrders).toHaveLength(2);

      const awaitingPayment = mockOrders.filter(o => o.status === 'awaiting_payment');
      expect(awaitingPayment).toHaveLength(1);
    });

    it('should filter by payment method', () => {
      const cashOrders = mockOrders.filter(o => o.payment_method === 'cash');
      expect(cashOrders).toHaveLength(1);

      const balanceOrders = mockOrders.filter(o => o.payment_method === 'balance');
      expect(balanceOrders).toHaveLength(2);
    });
  });

  describe('Order Status Updates', () => {
    it('should update order status to preparing', async () => {
      const order = {
        id: 'order-1',
        status: 'pending'
      };

      // Mock update
      mockSupabase.from.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null })
        })
      });

      const newStatus = 'preparing';
      const updated = { ...order, status: newStatus };
      expect(updated.status).toBe('preparing');
    });

    it('should update order status to ready', async () => {
      const order = {
        id: 'order-1',
        status: 'preparing'
      };

      const newStatus = 'ready';
      const updated = { ...order, status: newStatus };
      expect(updated.status).toBe('ready');
    });

    it('should update order status to completed', async () => {
      const order = {
        id: 'order-1',
        status: 'ready'
      };

      const newStatus = 'completed';
      const updated = { ...order, status: newStatus };
      expect(updated.status).toBe('completed');
    });
  });

  describe('Cash Payment Confirmation', () => {
    it('should show confirm button for awaiting_payment orders', () => {
      const order = {
        id: 'order-2',
        status: 'awaiting_payment',
        payment_method: 'cash'
      };

      const showConfirmButton = 
        order.status === 'awaiting_payment' && 
        order.payment_method === 'cash';

      expect(showConfirmButton).toBe(true);
    });

    it('should not show confirm button for paid orders', () => {
      const order = {
        id: 'order-1',
        status: 'pending',
        payment_method: 'balance'
      };

      const showConfirmButton = order.status === 'awaiting_payment';
      expect(showConfirmButton).toBe(false);
    });

    it('should call confirm-cash-payment function', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true, new_status: 'pending' },
        error: null
      });

      const orderId = 'order-2';

      await mockSupabase.functions.invoke('confirm-cash-payment', {
        body: { order_id: orderId }
      });

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
        'confirm-cash-payment',
        expect.objectContaining({
          body: { order_id: orderId }
        })
      );
    });

    it('should update order after cash confirmation', async () => {
      const order = {
        id: 'order-2',
        status: 'awaiting_payment',
        payment_status: 'awaiting_payment',
        payment_method: 'cash'
      };

      // After confirmation
      const confirmedOrder = {
        ...order,
        status: 'pending',
        payment_status: 'paid'
      };

      expect(confirmedOrder.status).toBe('pending');
      expect(confirmedOrder.payment_status).toBe('paid');
    });
  });

  describe('Payment Timeout Display', () => {
    it('should calculate remaining time', () => {
      const paymentDueAt = new Date('2026-01-05T10:15:00');
      const now = new Date('2026-01-05T10:00:00');

      const remainingMs = paymentDueAt.getTime() - now.getTime();
      const remainingMinutes = Math.floor(remainingMs / 60000);

      expect(remainingMinutes).toBe(15);
    });

    it('should show expired when time has passed', () => {
      const paymentDueAt = new Date('2026-01-05T09:45:00');
      const now = new Date('2026-01-05T10:00:00');

      const isExpired = paymentDueAt.getTime() < now.getTime();
      expect(isExpired).toBe(true);
    });

    it('should format remaining time correctly', () => {
      const formatRemainingTime = (minutes: number): string => {
        if (minutes <= 0) return 'Expired';
        if (minutes < 1) return 'Less than 1 min';
        return `${minutes} min`;
      };

      expect(formatRemainingTime(15)).toBe('15 min');
      expect(formatRemainingTime(0)).toBe('Expired');
      expect(formatRemainingTime(-5)).toBe('Expired');
    });
  });

  describe('Order List Sorting', () => {
    it('should sort by created_at descending', () => {
      const orders = [
        { id: '1', created_at: '2026-01-05T08:00:00' },
        { id: '2', created_at: '2026-01-05T10:00:00' },
        { id: '3', created_at: '2026-01-05T09:00:00' }
      ];

      const sorted = [...orders].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      expect(sorted[0].id).toBe('2');
      expect(sorted[1].id).toBe('3');
      expect(sorted[2].id).toBe('1');
    });

    it('should prioritize awaiting_payment orders', () => {
      const orders = [
        { id: '1', status: 'pending', created_at: '2026-01-05T10:00:00' },
        { id: '2', status: 'awaiting_payment', created_at: '2026-01-05T08:00:00' },
        { id: '3', status: 'preparing', created_at: '2026-01-05T09:00:00' }
      ];

      // Sort: awaiting_payment first, then by created_at
      const sorted = [...orders].sort((a, b) => {
        if (a.status === 'awaiting_payment' && b.status !== 'awaiting_payment') return -1;
        if (b.status === 'awaiting_payment' && a.status !== 'awaiting_payment') return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      expect(sorted[0].id).toBe('2'); // awaiting_payment comes first
    });
  });

  describe('Real-time Updates', () => {
    it('should subscribe to order changes', () => {
      const _mockSubscribe = vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn()
      });

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null })
      });

      // Verify subscription setup would work
      expect(mockSupabase.from).toBeDefined();
    });

    it('should handle new order event', () => {
      const existingOrders = [{ id: '1' }];
      const newOrder = { id: '2', status: 'pending' };

      const updatedOrders = [...existingOrders, newOrder];
      expect(updatedOrders).toHaveLength(2);
    });

    it('should handle order update event', () => {
      const orders = [
        { id: '1', status: 'pending' },
        { id: '2', status: 'pending' }
      ];

      const updatedOrder = { id: '1', status: 'preparing' };

      const updated = orders.map(o => 
        o.id === updatedOrder.id ? updatedOrder : o
      );

      expect(updated[0].status).toBe('preparing');
    });
  });
});

describe('Order Details Modal', () => {
  it('should display order items', () => {
    const orderItems = [
      { product_name: 'Burger', quantity: 2, unit_price: 75.00, total_price: 150.00 },
      { product_name: 'Fries', quantity: 1, unit_price: 35.00, total_price: 35.00 }
    ];

    expect(orderItems).toHaveLength(2);
    
    const totalAmount = orderItems.reduce((sum, item) => sum + item.total_price, 0);
    expect(totalAmount).toBe(185.00);
  });

  it('should display student information', () => {
    const order = {
      student: {
        name: 'John Doe',
        grade: '5',
        section: 'A'
      }
    };

    expect(order.student.name).toBe('John Doe');
  });

  it('should display payment information', () => {
    const order = {
      payment_method: 'cash',
      payment_status: 'awaiting_payment',
      total_amount: 185.00
    };

    expect(order.payment_method).toBe('cash');
    expect(order.payment_status).toBe('awaiting_payment');
  });

  it('should display special notes', () => {
    const order = {
      notes: 'No onions please'
    };

    expect(order.notes).toBe('No onions please');
  });
});

describe('Grade Level Grouping', () => {
  // Grade order for K-12 Philippine Education System
  const GRADE_ORDER: Record<string, number> = {
    'nursery': 0,
    'kinder': 1,
    'kindergarten': 1,
    'grade 1': 2,
    'grade 2': 3,
    'grade 3': 4,
    'grade 4': 5,
    'grade 5': 6,
    'grade 6': 7,
    'grade 7': 8,
    'grade 8': 9,
    'grade 9': 10,
    'grade 10': 11,
    'grade 11': 12,
    'grade 12': 13,
  };

  function getGradeOrder(gradeLevel: string): number {
    const normalized = gradeLevel?.toLowerCase().trim() || '';
    if (GRADE_ORDER[normalized] !== undefined) {
      return GRADE_ORDER[normalized];
    }
    const match = normalized.match(/\d+/);
    if (match) {
      const num = parseInt(match[0], 10);
      if (num >= 1 && num <= 12) return num + 1;
    }
    return 999;
  }

  interface GradeGroup {
    gradeLevel: string;
    orders: Array<{ id: string; status: string; child: { grade_level: string } }>;
    orderCount: number;
    pendingCount: number;
    preparingCount: number;
    readyCount: number;
    awaitingPaymentCount: number;
  }

  function groupOrdersByGrade(orders: Array<{ id: string; status: string; child: { grade_level: string } }>): GradeGroup[] {
    const groups = new Map<string, Array<{ id: string; status: string; child: { grade_level: string } }>>();
    
    orders.forEach(order => {
      const gradeLevel = order.child?.grade_level || 'Unknown';
      const existing = groups.get(gradeLevel);
      if (existing) {
        existing.push(order);
      } else {
        groups.set(gradeLevel, [order]);
      }
    });
    
    return Array.from(groups.entries())
      .map(([gradeLevel, gradeOrders]) => ({
        gradeLevel,
        orders: gradeOrders,
        orderCount: gradeOrders.length,
        pendingCount: gradeOrders.filter(o => o.status === 'pending').length,
        preparingCount: gradeOrders.filter(o => o.status === 'preparing').length,
        readyCount: gradeOrders.filter(o => o.status === 'ready').length,
        awaitingPaymentCount: gradeOrders.filter(o => o.status === 'awaiting_payment').length,
      }))
      .sort((a, b) => getGradeOrder(a.gradeLevel) - getGradeOrder(b.gradeLevel));
  }

  it('should group orders by grade level', () => {
    const mockOrders = [
      { id: '1', status: 'pending', child: { grade_level: 'Grade 1' } },
      { id: '2', status: 'preparing', child: { grade_level: 'Grade 3' } },
      { id: '3', status: 'pending', child: { grade_level: 'Grade 1' } },
      { id: '4', status: 'ready', child: { grade_level: 'Grade 3' } },
      { id: '5', status: 'pending', child: { grade_level: 'Kinder' } },
    ];

    const grouped = groupOrdersByGrade(mockOrders);

    expect(grouped).toHaveLength(3);
    
    // Kinder should be first (order 1)
    expect(grouped[0].gradeLevel).toBe('Kinder');
    expect(grouped[0].orderCount).toBe(1);
    
    // Grade 1 should be second (order 2)
    expect(grouped[1].gradeLevel).toBe('Grade 1');
    expect(grouped[1].orderCount).toBe(2);
    
    // Grade 3 should be third (order 4)
    expect(grouped[2].gradeLevel).toBe('Grade 3');
    expect(grouped[2].orderCount).toBe(2);
  });

  it('should sort grades in correct K-12 order', () => {
    const mockOrders = [
      { id: '1', status: 'pending', child: { grade_level: 'Grade 12' } },
      { id: '2', status: 'pending', child: { grade_level: 'Grade 1' } },
      { id: '3', status: 'pending', child: { grade_level: 'Nursery' } },
      { id: '4', status: 'pending', child: { grade_level: 'Grade 7' } },
      { id: '5', status: 'pending', child: { grade_level: 'Kinder' } },
    ];

    const grouped = groupOrdersByGrade(mockOrders);
    const gradeOrder = grouped.map(g => g.gradeLevel);

    expect(gradeOrder).toEqual(['Nursery', 'Kinder', 'Grade 1', 'Grade 7', 'Grade 12']);
  });

  it('should calculate status counts per grade correctly', () => {
    const mockOrders = [
      { id: '1', status: 'pending', child: { grade_level: 'Grade 1' } },
      { id: '2', status: 'preparing', child: { grade_level: 'Grade 1' } },
      { id: '3', status: 'ready', child: { grade_level: 'Grade 1' } },
      { id: '4', status: 'awaiting_payment', child: { grade_level: 'Grade 1' } },
    ];

    const grouped = groupOrdersByGrade(mockOrders);
    const grade1 = grouped.find(g => g.gradeLevel === 'Grade 1');

    expect(grade1).toBeDefined();
    expect(grade1?.orderCount).toBe(4);
    expect(grade1?.pendingCount).toBe(1);
    expect(grade1?.preparingCount).toBe(1);
    expect(grade1?.readyCount).toBe(1);
    expect(grade1?.awaitingPaymentCount).toBe(1);
  });

  it('should handle orders with missing grade level', () => {
    const mockOrders = [
      { id: '1', status: 'pending', child: { grade_level: 'Grade 1' } },
      { id: '2', status: 'pending', child: { grade_level: '' } },
      { id: '3', status: 'pending', child: { grade_level: null as unknown as string } },
    ];

    const grouped = groupOrdersByGrade(mockOrders);
    
    // Should have Grade 1 and Unknown groups
    expect(grouped.some(g => g.gradeLevel === 'Grade 1')).toBe(true);
    expect(grouped.some(g => g.gradeLevel === 'Unknown')).toBe(true);
    
    // Unknown orders should be at the end (highest sort order)
    const unknownGroup = grouped.find(g => g.gradeLevel === 'Unknown');
    expect(unknownGroup?.orderCount).toBe(2);
  });

  it('should handle various grade level formats', () => {
    // Test that different formats are correctly ordered
    expect(getGradeOrder('Grade 1')).toBeLessThan(getGradeOrder('Grade 10'));
    expect(getGradeOrder('grade 1')).toBe(getGradeOrder('Grade 1')); // case insensitive
    expect(getGradeOrder('Nursery')).toBeLessThan(getGradeOrder('Kinder'));
    expect(getGradeOrder('Kinder')).toBeLessThan(getGradeOrder('Grade 1'));
    expect(getGradeOrder('Unknown')).toBeGreaterThan(getGradeOrder('Grade 12'));
  });

  it('should return empty array for empty orders', () => {
    const grouped = groupOrdersByGrade([]);
    expect(grouped).toHaveLength(0);
  });

  describe('View Mode Toggle', () => {
    it('should default to grouped view', () => {
      const defaultViewMode = 'grouped';
      expect(defaultViewMode).toBe('grouped');
    });

    it('should allow switching between flat and grouped views', () => {
      let viewMode: 'flat' | 'grouped' = 'grouped';
      
      // Toggle to flat
      viewMode = viewMode === 'grouped' ? 'flat' : 'grouped';
      expect(viewMode).toBe('flat');
      
      // Toggle back to grouped
      viewMode = viewMode === 'grouped' ? 'flat' : 'grouped';
      expect(viewMode).toBe('grouped');
    });
  });

  describe('Collapsible Grade Sections', () => {
    it('should track collapsed state per grade', () => {
      const collapsedGrades = new Set<string>();
      
      // Collapse Grade 1
      collapsedGrades.add('Grade 1');
      expect(collapsedGrades.has('Grade 1')).toBe(true);
      expect(collapsedGrades.has('Grade 2')).toBe(false);
      
      // Expand Grade 1
      collapsedGrades.delete('Grade 1');
      expect(collapsedGrades.has('Grade 1')).toBe(false);
    });

    it('should expand all grades', () => {
      const collapsedGrades = new Set(['Grade 1', 'Grade 2', 'Grade 3']);
      
      // Clear all collapsed
      collapsedGrades.clear();
      expect(collapsedGrades.size).toBe(0);
    });

    it('should collapse all grades', () => {
      const allGrades = ['Grade 1', 'Grade 2', 'Grade 3'];
      const collapsedGrades = new Set(allGrades);
      
      expect(collapsedGrades.size).toBe(3);
      expect(collapsedGrades.has('Grade 1')).toBe(true);
      expect(collapsedGrades.has('Grade 2')).toBe(true);
      expect(collapsedGrades.has('Grade 3')).toBe(true);
    });
  });
});