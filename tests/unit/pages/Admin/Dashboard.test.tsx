import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../../../src/components/Toast';
import AdminDashboard from '../../../../src/pages/Admin/Dashboard';

// Mock the supabase client
vi.mock('../../../../src/services/supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn(),
    removeChannel: vi.fn()
  }
}));

import { supabase } from '../../../../src/services/supabaseClient';

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: 0, staleTime: 0 }
  }
});

const renderAdminDashboard = () => {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ToastProvider>
          <AdminDashboard />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('Admin Dashboard', () => {
  const mockChannel = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup supabase mock with chainable methods
    const chainMock = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      then: vi.fn((resolve) => resolve({ data: [], error: null, count: 0 }))
    };
    
    vi.mocked(supabase.from).mockReturnValue(chainMock as any);
    vi.mocked(supabase.channel).mockReturnValue(mockChannel as any);
    vi.mocked(supabase.removeChannel).mockReturnValue(undefined as any);
  });

  describe('Rendering', () => {
    it('renders dashboard title', async () => {
      renderAdminDashboard();
      
      await waitFor(() => {
        expect(screen.getByText(/Dashboard/)).toBeInTheDocument();
      });
    });
  });

  describe('Realtime Updates', () => {
    it('subscribes to order changes on mount', async () => {
      renderAdminDashboard();
      
      await waitFor(() => {
        expect(supabase.channel).toHaveBeenCalled();
      });
    });

    it('unsubscribes on unmount', async () => {
      const { unmount } = renderAdminDashboard();
      
      await waitFor(() => {
        expect(supabase.channel).toHaveBeenCalled();
      });

      unmount();
      
      expect(supabase.removeChannel).toHaveBeenCalled();
    });
  });
});

describe('Dashboard Statistics Logic', () => {
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

    expect(calculateChange(150, 100)).toBe(50);
    expect(calculateChange(75, 100)).toBe(-25);
    expect(calculateChange(100, 100)).toBe(0);
    expect(calculateChange(50, 0)).toBe(100);
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
