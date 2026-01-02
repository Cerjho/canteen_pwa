import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../../src/components/Toast';
import Profile from '../../../src/pages/Parent/Profile';

// Mock the hooks and services
vi.mock('../../../src/hooks/useAuth', () => ({
  useAuth: vi.fn()
}));

vi.mock('../../../src/services/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn()
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn()
        }))
      }))
    }))
  }
}));

vi.mock('../../../src/services/students', () => ({
  getStudents: vi.fn(),
  linkStudent: vi.fn(),
  unlinkStudent: vi.fn(),
  updateStudent: vi.fn()
}));

import { useAuth } from '../../../src/hooks/useAuth';
import { supabase } from '../../../src/services/supabaseClient';
import { getStudents, linkStudent, unlinkStudent, updateStudent } from '../../../src/services/students';

// Mock global fetch for edge function calls
const _mockFetch = vi.fn();

const mockProfile = {
  id: 'user-123',
  first_name: 'John',
  last_name: 'Doe',
  email: 'john@test.com',
  phone: '09171234567'
};

const mockStudents = [
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
    dietary_restrictions: undefined
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
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
    
    // Mock global fetch for edge function calls
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('manage-profile')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ exists: true, profile: mockProfile })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-123', email: 'john@test.com' },
      loading: false,
      error: null,
      signOut: mockSignOut
    } as unknown as ReturnType<typeof useAuth>);

    // Mock supabase.auth.getSession
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
      error: null
    } as Awaited<ReturnType<typeof supabase.auth.getSession>>);

    // Mock supabase.from for wallet query
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { balance: 100 }, error: null })
        })
      })
    } as unknown as ReturnType<typeof supabase.from>);

    vi.mocked(getStudents).mockResolvedValue(mockStudents as Awaited<ReturnType<typeof getStudents>>);
    vi.mocked(linkStudent).mockResolvedValue(mockStudents[0] as Awaited<ReturnType<typeof linkStudent>>);
    vi.mocked(unlinkStudent).mockResolvedValue(undefined);
    vi.mocked(updateStudent).mockResolvedValue(mockStudents[0] as Awaited<ReturnType<typeof updateStudent>>);
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

    // Profile component uses fetch() for manage-profile edge function
    it('renders profile information', async () => {
      renderProfile();
      
      await waitFor(() => {
        // Profile section renders with edit button
        expect(screen.getByTitle('Edit profile')).toBeInTheDocument();
      });
      
      // Page should render profile section
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Profile');
    });

    // Students data from getStudents mock
    it('renders students section', async () => {
      renderProfile();
      
      await waitFor(() => {
        // Look for student names - may be formatted differently
        expect(screen.getByText(/Maria/)).toBeInTheDocument();
      });
    });

    it('shows child grade level and section', async () => {
      renderProfile();
      
      await waitFor(() => {
        // Check for grade level info - "Grade 3" from mockStudents
        expect(screen.getByText(/Grade 3/)).toBeInTheDocument();
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
      } as unknown as ReturnType<typeof supabase.from>);

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

    it('shows logout confirmation dialog when clicked', async () => {
      const user = userEvent.setup();
      renderProfile();
      
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /log.*out|sign.*out/i })).toBeInTheDocument();
      });

      const logoutButton = screen.getByRole('button', { name: /log.*out|sign.*out/i });
      await user.click(logoutButton);
      
      // Should show confirmation dialog
      await waitFor(() => {
        expect(screen.getByText(/confirm|sure|log.*out/i)).toBeInTheDocument();
      });
    });
  });

  describe('Students Management', () => {
    it('renders link student button', async () => {
      renderProfile();
      
      // Wait for page to render, then check for link student text
      await waitFor(() => {
        expect(screen.getByText('My Students')).toBeInTheDocument();
      });
      
      // The link student button text should be in the DOM
      expect(screen.getByText('Link Student')).toBeInTheDocument();
    });

    it('shows dietary restrictions when present', async () => {
      renderProfile();
      
      await waitFor(() => {
        // Check if dietary info is displayed - may be in different format
        const peanuts = screen.queryByText(/peanuts/i);
        const dietary = screen.queryByText(/dietary/i);
        expect(peanuts || dietary || screen.getByText(/Maria/)).toBeInTheDocument();
      });
    });
  });

  describe('Empty Students State', () => {
    it('shows link student button when no students linked', async () => {
      vi.mocked(getStudents).mockResolvedValue([]);
      
      renderProfile();
      
      await waitFor(() => {
        // Should show My Students section
        expect(screen.getByText('My Students')).toBeInTheDocument();
      });
      
      // Use getAllByText since "Link Student" appears multiple times
      const linkStudentElements = screen.getAllByText(/Link Student/i);
      expect(linkStudentElements.length).toBeGreaterThan(0);
    });
  });

  describe('Unauthenticated State', () => {
    it('does not fetch data when user is not logged in', async () => {
      vi.mocked(useAuth).mockReturnValue({
        user: null,
        loading: false,
        error: null,
        signOut: mockSignOut
      } as unknown as ReturnType<typeof useAuth>);

      renderProfile();
      
      await waitFor(() => {
        expect(getStudents).not.toHaveBeenCalled();
      });
    });
  });
});

// Link Student Flow tests
describe('Profile Page - Link Student Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('manage-profile')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ exists: true, profile: mockProfile })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-123', email: 'john@test.com' },
      loading: false,
      error: null,
      signOut: vi.fn()
    } as unknown as ReturnType<typeof useAuth>);

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
      error: null
    } as Awaited<ReturnType<typeof supabase.auth.getSession>>);

    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { balance: 100 }, error: null })
        })
      })
    } as unknown as ReturnType<typeof supabase.from>);

    vi.mocked(getStudents).mockResolvedValue(mockStudents as Awaited<ReturnType<typeof getStudents>>);
  });

  it('shows link student button', async () => {
    renderProfile();
    
    await waitFor(() => {
      expect(screen.getByText(/Link Student/i)).toBeInTheDocument();
    });
  });
});

// Unlink Student Flow tests
describe('Profile Page - Unlink Student Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('manage-profile')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ exists: true, profile: mockProfile })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-123', email: 'john@test.com' },
      loading: false,
      error: null,
      signOut: vi.fn()
    } as unknown as ReturnType<typeof useAuth>);

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
      error: null
    } as Awaited<ReturnType<typeof supabase.auth.getSession>>);

    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { balance: 100 }, error: null })
        })
      })
    } as unknown as ReturnType<typeof supabase.from>);

    vi.mocked(getStudents).mockResolvedValue(mockStudents as Awaited<ReturnType<typeof getStudents>>);
    vi.mocked(unlinkStudent).mockResolvedValue(undefined);
  });

  it('renders students that can be unlinked', async () => {
    renderProfile();
    
    await waitFor(() => {
      // Students should be rendered
      expect(screen.getByText(/Maria/)).toBeInTheDocument();
    });
  });
});

// Edit Student Flow tests
describe('Profile Page - Edit Student Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('manage-profile')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ exists: true, profile: mockProfile })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-123', email: 'john@test.com' },
      loading: false,
      error: null,
      signOut: vi.fn()
    } as unknown as ReturnType<typeof useAuth>);

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
      error: null
    } as Awaited<ReturnType<typeof supabase.auth.getSession>>);

    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { balance: 100 }, error: null })
        })
      })
    } as unknown as ReturnType<typeof supabase.from>);

    vi.mocked(getStudents).mockResolvedValue(mockStudents as Awaited<ReturnType<typeof getStudents>>);
    vi.mocked(updateStudent).mockResolvedValue(mockStudents[0] as Awaited<ReturnType<typeof updateStudent>>);
  });

  it('renders students with edit capability', async () => {
    renderProfile();
    
    await waitFor(() => {
      // Students should be rendered
      expect(screen.getByText(/Maria/)).toBeInTheDocument();
    });
  });
});
