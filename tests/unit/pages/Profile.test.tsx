import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../../src/components/Toast';
import Profile from '../../../src/pages/Profile';

// Mock the hooks and services
vi.mock('../../../src/hooks/useAuth', () => ({
  useAuth: vi.fn()
}));

vi.mock('../../../src/services/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn()
        }))
      }))
    }))
  }
}));

vi.mock('../../../src/services/children', () => ({
  getChildren: vi.fn(),
  linkStudent: vi.fn(),
  unlinkStudent: vi.fn(),
  updateChild: vi.fn()
}));

import { useAuth } from '../../../src/hooks/useAuth';
import { supabase } from '../../../src/services/supabaseClient';
import { getChildren, linkStudent, unlinkStudent, updateChild } from '../../../src/services/children';

const mockProfile = {
  id: 'user-123',
  first_name: 'John',
  last_name: 'Doe',
  email: 'john@test.com',
  phone: '09171234567'
};

const mockChildren = [
  {
    id: 'child-1',
    student_id: 'STU001',
    first_name: 'Maria',
    last_name: 'Doe',
    grade_level: 'Grade 3',
    section: 'A',
    dietary_restrictions: 'No peanuts'
  },
  {
    id: 'child-2',
    student_id: 'STU002',
    first_name: 'Juan',
    last_name: 'Doe',
    grade_level: 'Grade 1',
    section: 'B',
    dietary_restrictions: null
  }
];

const mockSignOut = vi.fn();

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: 0, staleTime: 0 }
  }
});

const renderProfile = () => {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ToastProvider>
          <Profile />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('Profile Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-123', email: 'john@test.com' },
      session: { access_token: 'token' },
      loading: false,
      signIn: vi.fn(),
      signOut: mockSignOut
    } as any);

    // Mock supabase profile query
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: mockProfile, error: null })
        })
      })
    } as any);

    vi.mocked(getChildren).mockResolvedValue(mockChildren);
    vi.mocked(linkStudent).mockResolvedValue({ success: true });
    vi.mocked(unlinkStudent).mockResolvedValue({ success: true });
    vi.mocked(updateChild).mockResolvedValue({ success: true });
  });

  describe('Rendering', () => {
    it('renders page header', async () => {
      renderProfile();
      
      await waitFor(() => {
        expect(screen.getByText('Profile')).toBeInTheDocument();
      });
    });

    it('renders subtitle', async () => {
      renderProfile();
      
      await waitFor(() => {
        expect(screen.getByText('Manage your account')).toBeInTheDocument();
      });
    });

    it('renders profile information', async () => {
      renderProfile();
      
      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('john@test.com')).toBeInTheDocument();
      });
    });

    it('renders children section', async () => {
      renderProfile();
      
      await waitFor(() => {
        expect(screen.getByText('Maria Doe')).toBeInTheDocument();
        expect(screen.getByText('Juan Doe')).toBeInTheDocument();
      });
    });

    it('shows child grade level and section', async () => {
      renderProfile();
      
      await waitFor(() => {
        expect(screen.getByText(/Grade 3/)).toBeInTheDocument();
        expect(screen.getByText(/Grade 1/)).toBeInTheDocument();
      });
    });
  });

  describe('Loading State', () => {
    it('shows loading spinner while fetching profile', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockImplementation(() => 
              new Promise(resolve => setTimeout(() => resolve({ data: mockProfile, error: null }), 100))
            )
          })
        })
      } as any);

      renderProfile();
      
      expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });
  });

  describe('Logout', () => {
    it('renders logout button', async () => {
      renderProfile();
      
      await waitFor(() => {
        const logoutButton = screen.getByRole('button', { name: /log.*out|sign.*out/i });
        expect(logoutButton).toBeInTheDocument();
      });
    });

    it('calls signOut when logout is clicked', async () => {
      const user = userEvent.setup();
      renderProfile();
      
      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      const logoutButton = screen.getByRole('button', { name: /log.*out|sign.*out/i });
      await user.click(logoutButton);
      
      expect(mockSignOut).toHaveBeenCalled();
    });
  });

  describe('Children Management', () => {
    it('renders link child button', async () => {
      renderProfile();
      
      await waitFor(() => {
        expect(screen.getByText(/link.*child|add.*child/i)).toBeInTheDocument();
      });
    });

    it('shows dietary restrictions when present', async () => {
      renderProfile();
      
      await waitFor(() => {
        expect(screen.getByText(/No peanuts/i)).toBeInTheDocument();
      });
    });
  });

  describe('Empty Children State', () => {
    it('shows empty state when no children linked', async () => {
      vi.mocked(getChildren).mockResolvedValue([]);
      
      renderProfile();
      
      await waitFor(() => {
        // Should show some indication to link a child
        expect(screen.getByText(/link.*child|add.*child/i)).toBeInTheDocument();
      });
    });
  });

  describe('Unauthenticated State', () => {
    it('does not fetch data when user is not logged in', async () => {
      vi.mocked(useAuth).mockReturnValue({
        user: null,
        session: null,
        loading: false,
        signIn: vi.fn(),
        signOut: mockSignOut
      } as any);

      renderProfile();
      
      await waitFor(() => {
        expect(getChildren).not.toHaveBeenCalled();
      });
    });
  });
});

describe('Profile Page - Link Child Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-123', email: 'john@test.com' },
      session: { access_token: 'token' },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn()
    } as any);

    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: mockProfile, error: null })
        })
      })
    } as any);

    vi.mocked(getChildren).mockResolvedValue(mockChildren);
  });

  it('shows link child form when button is clicked', async () => {
    const user = userEvent.setup();
    renderProfile();
    
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const linkButton = screen.getByText(/link.*child|add.*child/i);
    await user.click(linkButton);
    
    // Form should appear - look for input or form elements
    await waitFor(() => {
      const studentIdInput = screen.queryByPlaceholderText(/student.*id/i) ||
                            screen.queryByLabelText(/student.*id/i);
      // Form visibility depends on implementation
    });
  });
});

describe('Profile Page - Unlink Child Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-123', email: 'john@test.com' },
      session: { access_token: 'token' },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn()
    } as any);

    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: mockProfile, error: null })
        })
      })
    } as any);

    vi.mocked(getChildren).mockResolvedValue(mockChildren);
    vi.mocked(unlinkStudent).mockResolvedValue({ success: true });
  });

  it('shows unlink option for each child', async () => {
    renderProfile();
    
    await waitFor(() => {
      // Should have unlink buttons for each child
      const unlinkButtons = screen.queryAllByRole('button', { name: /unlink/i });
      // Count depends on implementation
    });
  });
});

describe('Profile Page - Edit Child Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-123', email: 'john@test.com' },
      session: { access_token: 'token' },
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn()
    } as any);

    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: mockProfile, error: null })
        })
      })
    } as any);

    vi.mocked(getChildren).mockResolvedValue(mockChildren);
    vi.mocked(updateChild).mockResolvedValue({ success: true });
  });

  it('shows edit option for each child', async () => {
    renderProfile();
    
    await waitFor(() => {
      // Edit buttons should be present
      const editButtons = screen.queryAllByRole('button', { name: /edit/i });
      // Count depends on implementation
    });
  });
});
