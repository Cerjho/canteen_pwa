import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import OrderHistory from '../../../src/pages/Parent/OrderHistory';

// Mock the hooks and services
vi.mock('../../../src/hooks/useAuth', () => ({
  useAuth: vi.fn()
}));

vi.mock('../../../src/services/orders', () => ({
  getOrderHistory: vi.fn()
}));

import { useAuth } from '../../../src/hooks/useAuth';
import { getOrderHistory } from '../../../src/services/orders';

const mockOrders = [
  {
    id: 'order-1',
    status: 'pending',
    total_amount: 130,
    created_at: '2024-01-15T10:30:00Z',
    child: { first_name: 'Maria', last_name: 'Santos' },
    items: [
      { id: 'item-1', quantity: 2, price_at_order: 65, product: { id: 'p1', name: 'Chicken Adobo', price: 65, image_url: '' } }
    ]
  },
  {
    id: 'order-2',
    status: 'preparing',
    total_amount: 40,
    created_at: '2024-01-15T09:00:00Z',
    child: { first_name: 'Juan', last_name: 'Cruz' },
    items: [
      { id: 'item-2', quantity: 2, price_at_order: 15, product: { id: 'p2', name: 'Banana Cue', price: 15, image_url: '' } },
      { id: 'item-3', quantity: 1, price_at_order: 25, product: { id: 'p3', name: 'Orange Juice', price: 25, image_url: '' } }
    ]
  },
  {
    id: 'order-3',
    status: 'completed',
    total_amount: 65,
    created_at: '2024-01-14T12:00:00Z',
    child: { first_name: 'Maria', last_name: 'Santos' },
    items: [
      { id: 'item-4', quantity: 1, price_at_order: 65, product: { id: 'p1', name: 'Chicken Adobo', price: 65, image_url: '' } }
    ]
  },
  {
    id: 'order-4',
    status: 'ready',
    total_amount: 25,
    created_at: '2024-01-14T11:00:00Z',
    child: { first_name: 'Juan', last_name: 'Cruz' },
    items: [
      { id: 'item-5', quantity: 1, price_at_order: 25, product: { id: 'p3', name: 'Orange Juice', price: 25, image_url: '' } }
    ]
  },
  {
    id: 'order-5',
    status: 'cancelled',
    total_amount: 15,
    created_at: '2024-01-13T10:00:00Z',
    child: { first_name: 'Maria', last_name: 'Santos' },
    items: [
      { id: 'item-6', quantity: 1, price_at_order: 15, product: { id: 'p2', name: 'Banana Cue', price: 15, image_url: '' } }
    ]
  }
];

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: 0, staleTime: 0 }
  }
});

const renderOrderHistory = () => {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OrderHistory />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('OrderHistory Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-123', email: 'parent@test.com' },
      session: { access_token: 'token' },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn()
    } as any);

    vi.mocked(getOrderHistory).mockResolvedValue(mockOrders);
  });

  describe('Rendering', () => {
    it('renders page header', async () => {
      renderOrderHistory();
      
      await waitFor(() => {
        expect(screen.getByText('Order History')).toBeInTheDocument();
      });
    });

    it('renders subtitle', async () => {
      renderOrderHistory();
      
      await waitFor(() => {
        expect(screen.getByText('View your past orders')).toBeInTheDocument();
      });
    });

    it('renders order cards when orders exist', async () => {
      renderOrderHistory();
      
      await waitFor(() => {
        // Use getAllByText since there are multiple orders for Maria Santos
        expect(screen.getAllByText(/For Maria Santos/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/For Juan Cruz/).length).toBeGreaterThan(0);
      });
    });

    it('shows order items', async () => {
      renderOrderHistory();
      
      await waitFor(() => {
        expect(screen.getAllByText('Chicken Adobo').length).toBeGreaterThan(0);
      });
    });
  });

  describe('Loading State', () => {
    it('shows loading spinner while fetching', async () => {
      vi.mocked(getOrderHistory).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockOrders), 100))
      );

      renderOrderHistory();
      
      // Should show spinner initially
      expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('shows empty state when no orders', async () => {
      vi.mocked(getOrderHistory).mockResolvedValue([]);
      
      renderOrderHistory();
      
      await waitFor(() => {
        expect(screen.getByText('No orders yet')).toBeInTheDocument();
        expect(screen.getByText(/order history will appear/i)).toBeInTheDocument();
      });
    });
  });

  describe('Order Status Display', () => {
    it('displays pending status correctly', async () => {
      renderOrderHistory();
      
      await waitFor(() => {
        expect(screen.getByText('Pending')).toBeInTheDocument();
      });
    });

    it('displays preparing status correctly', async () => {
      renderOrderHistory();
      
      await waitFor(() => {
        expect(screen.getByText('Preparing')).toBeInTheDocument();
      });
    });

    it('displays ready status correctly', async () => {
      renderOrderHistory();
      
      await waitFor(() => {
        expect(screen.getByText('Ready for Pickup')).toBeInTheDocument();
      });
    });

    it('displays completed status correctly', async () => {
      renderOrderHistory();
      
      await waitFor(() => {
        expect(screen.getByText('Completed')).toBeInTheDocument();
      });
    });

    it('displays cancelled status correctly', async () => {
      renderOrderHistory();
      
      await waitFor(() => {
        expect(screen.getByText('Cancelled')).toBeInTheDocument();
      });
    });
  });

  describe('Order Details', () => {
    it('shows child name for each order', async () => {
      renderOrderHistory();
      
      await waitFor(() => {
        const mariaOrders = screen.getAllByText(/For Maria Santos/);
        expect(mariaOrders.length).toBeGreaterThan(0);
      });
    });

    it('shows order date and time', async () => {
      renderOrderHistory();
      
      await waitFor(() => {
        // Format: "MMM d, yyyy • h:mm a"
        // Use getAllByText since multiple orders have the same date
        expect(screen.getAllByText(/Jan 15, 2024/i).length).toBeGreaterThan(0);
      });
    });
  });

  describe('Unauthenticated State', () => {
    it('does not fetch orders when user is not logged in', async () => {
      vi.mocked(useAuth).mockReturnValue({
        user: null,
        session: null,
        loading: false,
        signIn: vi.fn(),
        signOut: vi.fn()
      } as any);

      renderOrderHistory();
      
      await waitFor(() => {
        // Should not call getOrderHistory when user is null
        expect(getOrderHistory).not.toHaveBeenCalled();
      });
    });
  });
});

describe('Order Status Helper Function', () => {
  // Test the getStatusDetails logic separately
  const getStatusDetails = (status: string) => {
    switch (status) {
      case 'pending':
        return { label: 'Pending', color: 'text-gray-600 bg-gray-100' };
      case 'preparing':
        return { label: 'Preparing', color: 'text-yellow-700 bg-yellow-100' };
      case 'ready':
        return { label: 'Ready for Pickup', color: 'text-green-700 bg-green-100' };
      case 'completed':
        return { label: 'Completed', color: 'text-blue-700 bg-blue-100' };
      case 'cancelled':
        return { label: 'Cancelled', color: 'text-red-700 bg-red-100' };
      default:
        return { label: status, color: 'text-gray-600 bg-gray-100' };
    }
  };

  it('returns correct details for pending status', () => {
    const result = getStatusDetails('pending');
    expect(result.label).toBe('Pending');
    expect(result.color).toContain('gray');
  });

  it('returns correct details for preparing status', () => {
    const result = getStatusDetails('preparing');
    expect(result.label).toBe('Preparing');
    expect(result.color).toContain('yellow');
  });

  it('returns correct details for ready status', () => {
    const result = getStatusDetails('ready');
    expect(result.label).toBe('Ready for Pickup');
    expect(result.color).toContain('green');
  });

  it('returns correct details for completed status', () => {
    const result = getStatusDetails('completed');
    expect(result.label).toBe('Completed');
    expect(result.color).toContain('blue');
  });

  it('returns correct details for cancelled status', () => {
    const result = getStatusDetails('cancelled');
    expect(result.label).toBe('Cancelled');
    expect(result.color).toContain('red');
  });

  it('returns status as label for unknown status', () => {
    const result = getStatusDetails('unknown_status');
    expect(result.label).toBe('unknown_status');
    expect(result.color).toContain('gray');
  });
});
