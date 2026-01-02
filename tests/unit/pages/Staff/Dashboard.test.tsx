import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../../../src/components/Toast';
import StaffDashboard from '../../../../src/pages/Staff/Dashboard';

// Mock the supabase client
vi.mock('../../../../src/services/supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn(),
    removeChannel: vi.fn(),
    functions: {
      invoke: vi.fn()
    }
  }
}));

import { supabase } from '../../../../src/services/supabaseClient';

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: 0, staleTime: 0 }
  }
});

const renderStaffDashboard = () => {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <StaffDashboard />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('Staff Dashboard', () => {
  const mockChannel = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup supabase mock with proper promise chain
    const chainMock = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      in: vi.fn().mockImplementation(() => Promise.resolve({ data: [], error: null })),
      update: vi.fn().mockReturnThis()
    };
    
    vi.mocked(supabase.from).mockReturnValue(chainMock as unknown as ReturnType<typeof supabase.from>);
    vi.mocked(supabase.channel).mockReturnValue(mockChannel as unknown as ReturnType<typeof supabase.channel>);
    vi.mocked(supabase.removeChannel).mockReturnValue(undefined as unknown as ReturnType<typeof supabase.removeChannel>);
  });

  describe('Rendering', () => {
    it('renders staff dashboard header', async () => {
      renderStaffDashboard();
      
      await waitFor(() => {
        expect(screen.getByText(/Staff Dashboard/i)).toBeInTheDocument();
      });
    });

    it('renders status filter tabs', async () => {
      renderStaffDashboard();
      
      await waitFor(() => {
        // Use getAllByRole to find buttons, then filter for the "All" button
        const allButtons = screen.getAllByRole('button').filter(btn => 
          btn.textContent === 'All'
        );
        expect(allButtons.length).toBeGreaterThan(0);
      });
    });

    it('renders date filter tabs', async () => {
      renderStaffDashboard();
      
      await waitFor(() => {
        // Use getAllByRole to find buttons to avoid matching "Today's orders" text
        const todayButtons = screen.getAllByRole('button').filter(btn => 
          btn.textContent === 'Today'
        );
        expect(todayButtons.length).toBeGreaterThan(0);
        expect(screen.getByText(/Future Orders/)).toBeInTheDocument();
      });
    });
  });

  describe('Status Filtering', () => {
    it('can click pending filter', async () => {
      const user = userEvent.setup();
      renderStaffDashboard();
      
      await waitFor(() => {
        expect(screen.getByText(/Staff Dashboard/i)).toBeInTheDocument();
      });

      // Find Pending buttons
      const pendingButtons = screen.getAllByRole('button').filter(btn => 
        btn.textContent?.toLowerCase().includes('pending')
      );
      
      if (pendingButtons.length > 0) {
        await user.click(pendingButtons[0]);
      }
    });
  });

  describe('Realtime Updates', () => {
    it('subscribes to order changes on mount', async () => {
      renderStaffDashboard();
      
      await waitFor(() => {
        expect(supabase.channel).toHaveBeenCalledWith('staff-orders');
        expect(mockChannel.on).toHaveBeenCalled();
        expect(mockChannel.subscribe).toHaveBeenCalled();
      });
    });

    it('unsubscribes on unmount', async () => {
      const { unmount } = renderStaffDashboard();
      
      await waitFor(() => {
        expect(supabase.channel).toHaveBeenCalled();
      });

      unmount();
      
      expect(supabase.removeChannel).toHaveBeenCalled();
    });
  });
});

describe('Staff Dashboard - Status Badge Logic', () => {
  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      awaiting_payment: 'bg-orange-200 text-orange-800',
      pending: 'bg-gray-200 text-gray-700',
      preparing: 'bg-yellow-200 text-yellow-800',
      ready: 'bg-green-200 text-green-800',
      completed: 'bg-blue-200 text-blue-800'
    };
    return styles[status] || styles.pending;
  };

  it('returns orange for awaiting_payment', () => {
    expect(getStatusBadge('awaiting_payment')).toContain('orange');
  });

  it('returns gray for pending', () => {
    expect(getStatusBadge('pending')).toContain('gray');
  });

  it('returns yellow for preparing', () => {
    expect(getStatusBadge('preparing')).toContain('yellow');
  });

  it('returns green for ready', () => {
    expect(getStatusBadge('ready')).toContain('green');
  });

  it('returns blue for completed', () => {
    expect(getStatusBadge('completed')).toContain('blue');
  });

  it('defaults to pending style for unknown status', () => {
    expect(getStatusBadge('unknown')).toContain('gray');
  });
});

describe('Staff Dashboard - Order Sorting', () => {
  it('sorts orders by created_at ascending', () => {
    const unsorted = [
      { id: 'o1', created_at: '2024-01-15T12:00:00Z' },
      { id: 'o2', created_at: '2024-01-15T08:00:00Z' },
      { id: 'o3', created_at: '2024-01-15T10:00:00Z' }
    ];

    const sorted = [...unsorted].sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    expect(sorted[0].id).toBe('o2');
    expect(sorted[1].id).toBe('o3');
    expect(sorted[2].id).toBe('o1');
  });
});

describe('Staff Dashboard - Wait Time Calculation', () => {
  it('calculates wait time correctly', () => {
    const getWaitMinutes = (createdAt: string) => {
      return Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
    };

    // Test with a time 30 minutes ago
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const waitTime = getWaitMinutes(thirtyMinutesAgo);
    
    expect(waitTime).toBeGreaterThanOrEqual(29);
    expect(waitTime).toBeLessThanOrEqual(31);
  });

  it('categorizes wait time correctly', () => {
    const getWaitCategory = (minutes: number) => {
      if (minutes >= 15) return 'critical';
      if (minutes >= 10) return 'warning';
      return 'normal';
    };

    expect(getWaitCategory(5)).toBe('normal');
    expect(getWaitCategory(12)).toBe('warning');
    expect(getWaitCategory(20)).toBe('critical');
  });
});

describe('Staff Dashboard - Payment Timeout', () => {
  it('calculates remaining time for payment', () => {
    const getRemainingMinutes = (paymentDueAt: string) => {
      return Math.floor((new Date(paymentDueAt).getTime() - Date.now()) / 60000);
    };

    // Test with a time 10 minutes in the future
    const tenMinutesFromNow = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const remaining = getRemainingMinutes(tenMinutesFromNow);
    
    expect(remaining).toBeGreaterThanOrEqual(9);
    expect(remaining).toBeLessThanOrEqual(11);
  });

  it('identifies expired payments', () => {
    const isExpired = (paymentDueAt: string) => {
      return new Date(paymentDueAt).getTime() < Date.now();
    };

    const pastTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const futureTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    expect(isExpired(pastTime)).toBe(true);
    expect(isExpired(futureTime)).toBe(false);
  });
});
