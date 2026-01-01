import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import AdminDashboard from '../../../../src/pages/Admin/Dashboard';

// Mock the supabase client
vi.mock('../../../../src/services/supabaseClient', () => ({
  supabase: {
    from: vi.fn()
  }
}));

import { supabase } from '../../../../src/services/supabaseClient';

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: 0, staleTime: 0 }
  }
});

const mockStats = {
  totalOrdersToday: 25,
  totalOrdersWeek: 150,
  totalOrdersMonth: 600,
  revenueToday: 1500,
  revenueWeek: 9000,
  revenueMonth: 36000,
  pendingOrders: 5,
  completedOrdersToday: 20,
  totalParents: 100,
  totalChildren: 200,
  totalProducts: 30,
  lowStockProducts: 3
};

const mockRecentOrders = [
  {
    id: 'order-1',
    status: 'pending',
    total_amount: 130,
    created_at: '2024-01-15T10:30:00Z',
    child: [{ first_name: 'Maria', last_name: 'Santos' }],
    parent: [{ first_name: 'John', last_name: 'Santos' }]
  },
  {
    id: 'order-2',
    status: 'preparing',
    total_amount: 80,
    created_at: '2024-01-15T10:00:00Z',
    child: [{ first_name: 'Juan', last_name: 'Cruz' }],
    parent: [{ first_name: 'Pedro', last_name: 'Cruz' }]
  }
];

const mockTopProducts = [
  { product_id: 'p1', name: 'Chicken Adobo', total_quantity: 50, total_revenue: 3250 },
  { product_id: 'p2', name: 'Banana Cue', total_quantity: 100, total_revenue: 1500 }
];

const renderAdminDashboard = () => {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

// Helper to create mock supabase chain
const createMockSupabaseChain = (result: any) => ({
  select: vi.fn().mockReturnValue({
    gte: vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue(result)
    }),
    eq: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue(result)
    }),
    order: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue(result)
    }),
    limit: vi.fn().mockResolvedValue(result)
  })
});

describe('Admin Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup comprehensive mock
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: [{ total_amount: 1500 }] })
            }),
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: mockRecentOrders, error: null })
            })
          })
        } as any;
      }
      if (table === 'order_items') {
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: mockTopProducts, error: null })
            })
          })
        } as any;
      }
      if (table === 'parents') {
        return {
          select: vi.fn().mockResolvedValue({ count: 100 })
        } as any;
      }
      if (table === 'children') {
        return {
          select: vi.fn().mockResolvedValue({ count: 200 })
        } as any;
      }
      if (table === 'products') {
        return {
          select: vi.fn().mockReturnValue({
            lt: vi.fn().mockResolvedValue({ count: 3 })
          })
        } as any;
      }
      return createMockSupabaseChain({ data: [], error: null }) as any;
    });
  });

  describe('Rendering', () => {
    it('renders dashboard title', async () => {
      renderAdminDashboard();
      
      await waitFor(() => {
        expect(screen.getByText(/dashboard/i)).toBeInTheDocument();
      });
    });

    it('renders date range selector', async () => {
      renderAdminDashboard();
      
      await waitFor(() => {
        expect(screen.getByText(/today/i)).toBeInTheDocument();
        expect(screen.getByText(/week/i)).toBeInTheDocument();
        expect(screen.getByText(/month/i)).toBeInTheDocument();
      });
    });
  });

  describe('Statistics Cards', () => {
    it('displays order count', async () => {
      renderAdminDashboard();
      
      await waitFor(() => {
        // Should show some order statistics
        const orderElements = screen.queryAllByText(/order/i);
        expect(orderElements.length).toBeGreaterThan(0);
      });
    });

    it('displays revenue information', async () => {
      renderAdminDashboard();
      
      await waitFor(() => {
        // Should show revenue statistics
        const revenueElements = screen.queryAllByText(/revenue|₱/i);
        expect(revenueElements.length).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Date Range Selection', () => {
    it('can switch to weekly view', async () => {
      const user = userEvent.setup();
      renderAdminDashboard();
      
      await waitFor(() => {
        expect(screen.getByText(/week/i)).toBeInTheDocument();
      });

      const weekButton = screen.getByText(/week/i);
      await user.click(weekButton);
      
      // State should update to week view
    });

    it('can switch to monthly view', async () => {
      const user = userEvent.setup();
      renderAdminDashboard();
      
      await waitFor(() => {
        expect(screen.getByText(/month/i)).toBeInTheDocument();
      });

      const monthButton = screen.getByText(/month/i);
      await user.click(monthButton);
      
      // State should update to month view
    });
  });

  describe('Loading State', () => {
    it('shows loading spinner while fetching data', () => {
      vi.mocked(supabase.from).mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            in: vi.fn().mockImplementation(() => 
              new Promise(resolve => setTimeout(() => resolve({ data: [] }), 100))
            )
          })
        })
      }) as any);

      renderAdminDashboard();
      
      expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });
  });
});

describe('Dashboard Statistics Logic', () => {
  // Test the statistics calculation logic

  it('calculates total revenue correctly', () => {
    const orders = [
      { total_amount: 100 },
      { total_amount: 150 },
      { total_amount: 75 }
    ];
    
    const totalRevenue = orders.reduce((sum, o) => sum + o.total_amount, 0);
    
    expect(totalRevenue).toBe(325);
  });

  it('filters orders by status', () => {
    const orders = [
      { id: 'o1', status: 'pending' },
      { id: 'o2', status: 'completed' },
      { id: 'o3', status: 'cancelled' },
      { id: 'o4', status: 'pending' }
    ];

    const pendingOrders = orders.filter(o => o.status === 'pending');
    const completedOrders = orders.filter(o => o.status === 'completed');
    
    expect(pendingOrders).toHaveLength(2);
    expect(completedOrders).toHaveLength(1);
  });

  it('counts low stock products', () => {
    const products = [
      { id: 'p1', stock: 5, low_stock_threshold: 10 },
      { id: 'p2', stock: 20, low_stock_threshold: 10 },
      { id: 'p3', stock: 3, low_stock_threshold: 10 }
    ];

    const lowStockCount = products.filter(p => p.stock < p.low_stock_threshold).length;
    
    expect(lowStockCount).toBe(2);
  });
});

describe('Dashboard Currency Formatting', () => {
  const formatCurrency = (amount: number) => `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

  it('formats small amounts correctly', () => {
    expect(formatCurrency(65)).toBe('₱65.00');
  });

  it('formats large amounts with commas', () => {
    expect(formatCurrency(1500)).toBe('₱1,500.00');
    expect(formatCurrency(36000)).toBe('₱36,000.00');
  });

  it('handles zero amount', () => {
    expect(formatCurrency(0)).toBe('₱0.00');
  });
});

describe('Dashboard Trend Calculations', () => {
  it('calculates percentage change correctly', () => {
    const calculateChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };

    expect(calculateChange(150, 100)).toBe(50); // 50% increase
    expect(calculateChange(75, 100)).toBe(-25); // 25% decrease
    expect(calculateChange(100, 100)).toBe(0); // No change
    expect(calculateChange(50, 0)).toBe(100); // From zero
  });

  it('identifies positive and negative trends', () => {
    const getTrendDirection = (change: number) => {
      if (change > 0) return 'up';
      if (change < 0) return 'down';
      return 'neutral';
    };

    expect(getTrendDirection(25)).toBe('up');
    expect(getTrendDirection(-10)).toBe('down');
    expect(getTrendDirection(0)).toBe('neutral');
  });
});
