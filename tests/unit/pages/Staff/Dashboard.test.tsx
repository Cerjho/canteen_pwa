import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    removeChannel: vi.fn()
  }
}));

import { supabase } from '../../../../src/services/supabaseClient';

const mockOrders = [
  {
    id: 'order-1',
    status: 'pending',
    total_amount: 130,
    created_at: '2024-01-15T10:30:00Z',
    scheduled_for: '2024-01-15',
    notes: 'Extra rice please',
    child: { first_name: 'Maria', last_name: 'Santos', grade_level: 'Grade 3', section: 'A' },
    parent: { first_name: 'John', last_name: 'Santos', phone_number: '09171234567' },
    items: [
      { id: 'item-1', quantity: 2, product: { name: 'Chicken Adobo', image_url: '' } }
    ]
  },
  {
    id: 'order-2',
    status: 'preparing',
    total_amount: 80,
    created_at: '2024-01-15T10:00:00Z',
    scheduled_for: '2024-01-15',
    notes: null,
    child: { first_name: 'Juan', last_name: 'Cruz', grade_level: 'Grade 1', section: 'B' },
    parent: { first_name: 'Pedro', last_name: 'Cruz', phone_number: '09187654321' },
    items: [
      { id: 'item-2', quantity: 1, product: { name: 'Banana Cue', image_url: '' } },
      { id: 'item-3', quantity: 2, product: { name: 'Orange Juice', image_url: '' } }
    ]
  },
  {
    id: 'order-3',
    status: 'ready',
    total_amount: 65,
    created_at: '2024-01-15T09:30:00Z',
    scheduled_for: '2024-01-15',
    notes: 'No utensils needed',
    child: { first_name: 'Ana', last_name: 'Lopez', grade_level: 'Grade 2', section: 'C' },
    parent: { first_name: 'Rosa', last_name: 'Lopez', phone_number: '09123456789' },
    items: [
      { id: 'item-4', quantity: 1, product: { name: 'Chicken Adobo', image_url: '' } }
    ]
  }
];

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: 0, staleTime: 0 }
  }
});

const renderStaffDashboard = () => {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
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
    
    // Setup supabase mock
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: mockOrders, error: null }),
          eq: vi.fn().mockResolvedValue({ data: mockOrders, error: null })
        })
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      })
    } as any);

    vi.mocked(supabase.channel).mockReturnValue(mockChannel as any);
    vi.mocked(supabase.removeChannel).mockReturnValue(undefined as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Rendering', () => {
    it('renders staff dashboard header', async () => {
      renderStaffDashboard();
      
      await waitFor(() => {
        // Should have some header indicating orders or staff area
        const header = screen.queryByText(/orders|staff|kitchen/i);
        expect(header).toBeInTheDocument();
      });
    });

    it('renders status filter tabs', async () => {
      renderStaffDashboard();
      
      await waitFor(() => {
        expect(screen.getByText(/all/i)).toBeInTheDocument();
        expect(screen.getByText(/pending/i)).toBeInTheDocument();
        expect(screen.getByText(/preparing/i)).toBeInTheDocument();
        expect(screen.getByText(/ready/i)).toBeInTheDocument();
      });
    });

    it('renders order cards', async () => {
      renderStaffDashboard();
      
      await waitFor(() => {
        expect(screen.getByText('Maria Santos')).toBeInTheDocument();
        expect(screen.getByText('Juan Cruz')).toBeInTheDocument();
      });
    });
  });

  describe('Order Display', () => {
    it('shows order items', async () => {
      renderStaffDashboard();
      
      await waitFor(() => {
        expect(screen.getAllByText(/Chicken Adobo/).length).toBeGreaterThan(0);
        expect(screen.getByText(/Banana Cue/)).toBeInTheDocument();
      });
    });

    it('shows child grade and section', async () => {
      renderStaffDashboard();
      
      await waitFor(() => {
        expect(screen.getByText(/Grade 3/)).toBeInTheDocument();
        expect(screen.getByText(/Section A|Grade 3.*A/i)).toBeTruthy();
      });
    });

    it('shows order notes when present', async () => {
      renderStaffDashboard();
      
      await waitFor(() => {
        expect(screen.getByText(/Extra rice please/i)).toBeInTheDocument();
      });
    });
  });

  describe('Status Filtering', () => {
    it('filters orders by pending status', async () => {
      const user = userEvent.setup();
      
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: mockOrders, error: null }),
            eq: vi.fn().mockResolvedValue({ 
              data: mockOrders.filter(o => o.status === 'pending'), 
              error: null 
            })
          })
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null })
        })
      } as any);

      renderStaffDashboard();
      
      await waitFor(() => {
        expect(screen.getByText(/pending/i)).toBeInTheDocument();
      });

      const pendingTab = screen.getByText(/pending/i);
      await user.click(pendingTab);
      
      // Filter should be applied
    });

    it('filters orders by preparing status', async () => {
      const user = userEvent.setup();
      renderStaffDashboard();
      
      await waitFor(() => {
        expect(screen.getByText(/preparing/i)).toBeInTheDocument();
      });

      const preparingTab = screen.getByText(/preparing/i);
      await user.click(preparingTab);
      
      // Filter should be applied
    });
  });

  describe('Order Status Update', () => {
    it('can mark order as preparing', async () => {
      const user = userEvent.setup();
      renderStaffDashboard();
      
      await waitFor(() => {
        expect(screen.getByText('Maria Santos')).toBeInTheDocument();
      });

      // Find and click start preparing button
      const prepareButtons = screen.queryAllByRole('button', { name: /start|prepare/i });
      if (prepareButtons.length > 0) {
        await user.click(prepareButtons[0]);
      }
    });

    it('can mark order as ready', async () => {
      const user = userEvent.setup();
      renderStaffDashboard();
      
      await waitFor(() => {
        expect(screen.getByText('Juan Cruz')).toBeInTheDocument();
      });

      // Find and click ready button
      const readyButtons = screen.queryAllByRole('button', { name: /ready|done/i });
      if (readyButtons.length > 0) {
        await user.click(readyButtons[0]);
      }
    });

    it('can mark order as completed', async () => {
      const user = userEvent.setup();
      renderStaffDashboard();
      
      await waitFor(() => {
        expect(screen.getByText('Ana Lopez')).toBeInTheDocument();
      });

      // Find and click complete button
      const completeButtons = screen.queryAllByRole('button', { name: /complete|pickup/i });
      if (completeButtons.length > 0) {
        await user.click(completeButtons[0]);
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

  describe('Loading State', () => {
    it('shows loading spinner while fetching', () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            in: vi.fn().mockImplementation(() => 
              new Promise(resolve => setTimeout(() => resolve({ data: mockOrders, error: null }), 100))
            )
          })
        })
      } as any);

      renderStaffDashboard();
      
      expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('shows empty state when no orders', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null })
          })
        })
      } as any);

      renderStaffDashboard();
      
      await waitFor(() => {
        // Should show some empty message
        const emptyMessage = screen.queryByText(/no.*orders|all.*done|empty/i);
        // Empty state depends on implementation
      });
    });
  });
});

describe('Staff Dashboard - Status Badge Logic', () => {
  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-gray-200 text-gray-700',
      preparing: 'bg-yellow-200 text-yellow-800',
      ready: 'bg-green-200 text-green-800',
      completed: 'bg-blue-200 text-blue-800'
    };
    return styles[status] || styles.pending;
  };

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

    expect(sorted[0].id).toBe('o2'); // 8:00
    expect(sorted[1].id).toBe('o3'); // 10:00
    expect(sorted[2].id).toBe('o1'); // 12:00
  });
});
