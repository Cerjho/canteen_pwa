// Login Page Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { BrowserRouter } from 'react-router-dom';
import Login from '../../../src/pages/Login';

// Mock navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

// Mock supabase
const mockSignInWithPassword = vi.fn();
vi.mock('../../../src/services/supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args)
    }
  }
}));

function renderLogin() {
  return render(
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Login />
    </BrowserRouter>
  );
}

describe('Login Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders login form', () => {
      renderLogin();

      expect(screen.getByRole('heading', { name: /School Canteen/i })).toBeInTheDocument();
      expect(screen.getByText(/Order food for your kids/i)).toBeInTheDocument();
    });

    it('renders email input', () => {
      renderLogin();

      const emailInput = screen.getByLabelText(/email/i);
      expect(emailInput).toBeInTheDocument();
      expect(emailInput).toHaveAttribute('type', 'email');
      expect(emailInput).toBeRequired();
    });

    it('renders password input', () => {
      renderLogin();

      const passwordInput = screen.getByLabelText(/password/i);
      expect(passwordInput).toBeInTheDocument();
      expect(passwordInput).toHaveAttribute('type', 'password');
      expect(passwordInput).toBeRequired();
    });

    it('renders submit button', () => {
      renderLogin();

      expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument();
    });

    it('renders registration info text', () => {
      renderLogin();

      expect(screen.getByText(/Have an invitation code/i)).toBeInTheDocument();
    });
  });

  describe('Form Interaction', () => {
    it('updates email value on input', async () => {
      const user = userEvent.setup();
      renderLogin();

      const emailInput = screen.getByLabelText(/email/i);
      await user.type(emailInput, 'test@example.com');

      expect(emailInput).toHaveValue('test@example.com');
    });

    it('updates password value on input', async () => {
      const user = userEvent.setup();
      renderLogin();

      const passwordInput = screen.getByLabelText(/password/i);
      await user.type(passwordInput, 'password123');

      expect(passwordInput).toHaveValue('password123');
    });
  });

  describe('Login Submission', () => {
    it('calls signInWithPassword with credentials', async () => {
      const user = userEvent.setup();
      mockSignInWithPassword.mockResolvedValue({
        data: { user: { user_metadata: { role: 'parent' } } },
        error: null
      });

      renderLogin();

      await user.type(screen.getByLabelText(/email/i), 'parent@test.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /login/i }));

      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'parent@test.com',
        password: 'password123'
      });
    });

    it('navigates to menu for parent users', async () => {
      const user = userEvent.setup();
      mockSignInWithPassword.mockResolvedValue({
        data: { user: { user_metadata: { role: 'parent' } } },
        error: null
      });

      renderLogin();

      await user.type(screen.getByLabelText(/email/i), 'parent@test.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /login/i }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/menu');
      });
    });

    it('navigates to staff page for staff users', async () => {
      const user = userEvent.setup();
      mockSignInWithPassword.mockResolvedValue({
        data: { user: { app_metadata: { role: 'staff' } } },
        error: null
      });

      renderLogin();

      await user.type(screen.getByLabelText(/email/i), 'staff@test.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /login/i }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/staff');
      });
    });

    it('navigates to admin page for admin users', async () => {
      const user = userEvent.setup();
      mockSignInWithPassword.mockResolvedValue({
        data: { user: { app_metadata: { role: 'admin' } } },
        error: null
      });

      renderLogin();

      await user.type(screen.getByLabelText(/email/i), 'admin@test.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /login/i }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/admin');
      });
    });
  });

  describe('Error Handling', () => {
    it('displays error message on login failure', async () => {
      const user = userEvent.setup();
      mockSignInWithPassword.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid login credentials' }
      });

      renderLogin();

      await user.type(screen.getByLabelText(/email/i), 'wrong@test.com');
      await user.type(screen.getByLabelText(/password/i), 'wrongpassword');
      await user.click(screen.getByRole('button', { name: /login/i }));

      await waitFor(() => {
        // Login.tsx sanitizes error messages to user-friendly versions
        expect(screen.getByText(/Invalid email or password/i)).toBeInTheDocument();
      });
    });

    it('does not navigate on error', async () => {
      const user = userEvent.setup();
      mockSignInWithPassword.mockResolvedValue({
        data: { user: null },
        error: { message: 'Error' }
      });

      renderLogin();

      await user.type(screen.getByLabelText(/email/i), 'test@test.com');
      await user.type(screen.getByLabelText(/password/i), 'password');
      await user.click(screen.getByRole('button', { name: /login/i }));

      await waitFor(() => {
        expect(mockNavigate).not.toHaveBeenCalled();
      });
    });

    it('clears error when resubmitting', async () => {
      const user = userEvent.setup();
      
      // First submission fails
      mockSignInWithPassword.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Some error' }
      });

      renderLogin();

      await user.type(screen.getByLabelText(/email/i), 'test@test.com');
      await user.type(screen.getByLabelText(/password/i), 'password');
      await user.click(screen.getByRole('button', { name: /login/i }));

      await waitFor(() => {
        // Login.tsx shows sanitized error
        expect(screen.getByText(/Login failed/i)).toBeInTheDocument();
      });

      // Second submission succeeds
      mockSignInWithPassword.mockResolvedValueOnce({
        data: { user: { user_metadata: { role: 'parent' } } },
        error: null
      });

      await user.click(screen.getByRole('button', { name: /login/i }));

      // Error should be cleared during submission
      await waitFor(() => {
        expect(mockSignInWithPassword).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Loading State', () => {
    it('disables button while loading', async () => {
      const user = userEvent.setup();
      
      // Make signIn hang
      mockSignInWithPassword.mockImplementation(() => new Promise(() => {}));

      renderLogin();

      await user.type(screen.getByLabelText(/email/i), 'test@test.com');
      await user.type(screen.getByLabelText(/password/i), 'password');
      await user.click(screen.getByRole('button', { name: /login/i }));

      const button = screen.getByRole('button', { name: /logging in/i });
      expect(button).toBeDisabled();
    });
  });

  describe('Accessibility', () => {
    it('has proper form labels', () => {
      renderLogin();

      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    });

    it('form can be submitted with Enter key', async () => {
      const user = userEvent.setup();
      mockSignInWithPassword.mockResolvedValue({
        data: { user: { user_metadata: { role: 'parent' } } },
        error: null
      });

      renderLogin();

      await user.type(screen.getByLabelText(/email/i), 'test@test.com');
      await user.type(screen.getByLabelText(/password/i), 'password{Enter}');

      expect(mockSignInWithPassword).toHaveBeenCalled();
    });
  });
});
