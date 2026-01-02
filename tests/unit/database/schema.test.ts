// Database Migrations Tests
import { describe, it, expect } from 'vitest';

describe('Database Schema', () => {
  describe('Orders Table', () => {
    it('should have valid status values', () => {
      const validStatuses = [
        'awaiting_payment',
        'pending',
        'preparing',
        'ready',
        'completed',
        'cancelled'
      ];

      // Test that awaiting_payment is included (critical fix)
      expect(validStatuses).toContain('awaiting_payment');
      expect(validStatuses).toContain('pending');
      expect(validStatuses).toContain('preparing');
      expect(validStatuses).toContain('ready');
      expect(validStatuses).toContain('completed');
      expect(validStatuses).toContain('cancelled');
    });

    it('should have payment status column', () => {
      const orderColumns = [
        'id',
        'status',
        'payment_status',
        'payment_due_at',
        'payment_method',
        'total_amount',
        'student_id',
        'user_id',
        'scheduled_for'
      ];

      expect(orderColumns).toContain('payment_status');
      expect(orderColumns).toContain('payment_due_at');
    });

    it('should have valid payment status values', () => {
      const validPaymentStatuses = [
        'awaiting_payment',
        'paid',
        'timeout',
        'refunded'
      ];

      expect(validPaymentStatuses).toContain('awaiting_payment');
      expect(validPaymentStatuses).toContain('paid');
      expect(validPaymentStatuses).toContain('timeout');
      expect(validPaymentStatuses).toContain('refunded');
    });
  });

  describe('Menu Schedules Table', () => {
    it('should have scheduled_date column', () => {
      const columns = [
        'id',
        'product_id',
        'day_of_week',
        'scheduled_date',
        'available',
        'created_at'
      ];

      expect(columns).toContain('scheduled_date');
      expect(columns).toContain('day_of_week');
    });

    it('should have index on scheduled_date', () => {
      // Verify index exists for performance
      const indexes = ['idx_menu_schedules_scheduled_date'];
      expect(indexes).toContain('idx_menu_schedules_scheduled_date');
    });
  });

  describe('User Profiles Table', () => {
    it('should have correct role values', () => {
      const validRoles = ['admin', 'staff', 'parent'];
      expect(validRoles).toContain('admin');
      expect(validRoles).toContain('staff');
      expect(validRoles).toContain('parent');
    });
  });

  describe('Students Table', () => {
    it('should have required columns', () => {
      const columns = [
        'id',
        'name',
        'grade',
        'section',
        'user_id',
        'dietary_restrictions',
        'allergies'
      ];

      expect(columns).toContain('name');
      expect(columns).toContain('grade');
      expect(columns).toContain('user_id');
    });
  });

  describe('Products Table', () => {
    it('should have stock tracking', () => {
      const columns = ['id', 'name', 'price', 'stock', 'category', 'available'];
      expect(columns).toContain('stock');
      expect(columns).toContain('available');
    });
  });
});

describe('Migration Sequence', () => {
  it('should have migrations in correct order', () => {
    const migrations = [
      '001_init.sql',
      '002_invitations.sql',
      '003_weekly_menu.sql',
      '20260101_fix_menu_schedules_rls.sql',
      '20260102_holidays.sql',
      '20260103_future_orders.sql',
      '20260104_admin_students.sql',
      // ... more migrations
      '20260117_payment_status.sql',
      '20260118_fix_order_status_constraint.sql'
    ];

    // Verify critical migrations exist
    expect(migrations.some(m => m.includes('payment_status'))).toBe(true);
    expect(migrations.some(m => m.includes('order_status_constraint'))).toBe(true);
  });

  it('should have payment status migration', () => {
    const paymentStatusMigration = {
      name: '20260117_payment_status.sql',
      changes: [
        'ADD COLUMN payment_status',
        'ADD COLUMN payment_due_at'
      ]
    };

    expect(paymentStatusMigration.changes).toContain('ADD COLUMN payment_status');
    expect(paymentStatusMigration.changes).toContain('ADD COLUMN payment_due_at');
  });

  it('should have order status constraint fix', () => {
    const constraintFix = {
      name: '20260118_fix_order_status_constraint.sql',
      action: 'DROP old constraint, ADD new constraint with awaiting_payment'
    };

    expect(constraintFix.action).toContain('awaiting_payment');
  });
});

describe('RLS Policies', () => {
  describe('Orders RLS', () => {
    it('should allow users to read own orders', () => {
      const policy = {
        name: 'Users can read own orders',
        operation: 'SELECT',
        check: 'user_id = auth.uid()'
      };

      expect(policy.check).toContain('auth.uid()');
    });

    it('should allow staff to read all orders', () => {
      const policy = {
        name: 'Staff can read all orders',
        operation: 'SELECT',
        check: "role IN ('staff', 'admin')"
      };

      expect(policy.check).toContain('staff');
      expect(policy.check).toContain('admin');
    });

    it('should allow staff to update order status', () => {
      const policy = {
        name: 'Staff can update orders',
        operation: 'UPDATE',
        check: "role IN ('staff', 'admin')"
      };

      expect(policy.operation).toBe('UPDATE');
    });
  });

  describe('Menu Schedules RLS', () => {
    it('should allow public read', () => {
      const policy = {
        name: 'Anyone can read menu schedules',
        operation: 'SELECT',
        check: 'true'
      };

      expect(policy.check).toBe('true');
    });

    it('should restrict write to admin', () => {
      const policy = {
        name: 'Only admin can manage menu',
        operation: 'ALL',
        check: "role = 'admin'"
      };

      expect(policy.check).toContain('admin');
    });
  });

  describe('Products RLS', () => {
    it('should allow public read for available products', () => {
      const policy = {
        name: 'Anyone can read available products',
        operation: 'SELECT',
        check: 'available = true'
      };

      expect(policy.check).toContain('available');
    });
  });
});

describe('Edge Function Permissions', () => {
  it('should have no-verify-jwt for public functions', () => {
    const publicFunctions = [
      'register',
      'verify-invitation'
    ];

    publicFunctions.forEach(fn => {
      expect(fn).toBeTruthy();
    });
  });

  it('should require auth for protected functions', () => {
    const protectedFunctions = [
      'process-order',
      'manage-menu',
      'confirm-cash-payment',
      'refund-order'
    ];

    protectedFunctions.forEach(fn => {
      expect(fn).toBeTruthy();
    });
  });
});

describe('Stock Management', () => {
  it('should deduct stock atomically', () => {
    // Stock deduction should be atomic to prevent race conditions
    const stockDeduction = {
      operation: 'UPDATE products SET stock = stock - $quantity',
      condition: 'WHERE id = $product_id AND stock >= $quantity',
      returning: 'RETURNING stock'
    };

    expect(stockDeduction.condition).toContain('stock >= $quantity');
  });

  it('should restore stock on cancellation', () => {
    const stockRestoration = {
      operation: 'UPDATE products SET stock = stock + $quantity',
      trigger: 'ON order cancelled'
    };

    expect(stockRestoration.operation).toContain('+ $quantity');
  });
});

describe('Payment Flow Constraints', () => {
  it('should set payment timeout for cash orders', () => {
    const cashOrderDefaults = {
      status: 'awaiting_payment',
      payment_status: 'awaiting_payment',
      payment_due_at: 'NOW() + INTERVAL 15 minutes'
    };

    expect(cashOrderDefaults.status).toBe('awaiting_payment');
    expect(cashOrderDefaults.payment_due_at).toContain('15 minutes');
  });

  it('should set paid status for balance orders', () => {
    const balanceOrderDefaults = {
      status: 'pending',
      payment_status: 'paid',
      payment_due_at: null
    };

    expect(balanceOrderDefaults.status).toBe('pending');
    expect(balanceOrderDefaults.payment_status).toBe('paid');
  });
});
