// useAuth Hook Tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAuth } from '../../src/hooks/useAuth';

// Mock supabase client
const mockUnsubscribe = vi.fn();
let authChangeCallback: ((event: string, session: any) => void) | null = null;

const mockSupabase = {
  auth: {
    getSession: vi.fn(),
    signOut: vi.fn(),
    onAuthStateChange: vi.fn((callback) => {
      authChangeCallback = callback;
      return {
        data: {
          subscription: {
            unsubscribe: mockUnsubscribe
          }
        }
      };
    })
  }
};

vi.mock('../../src/services/supabaseClient', () => ({
  supabase: mockSupabase
}));

describe('useAuth Hook', () => {
  const mockUser = {
    id: 'test-user-123',
    email: 'test@example.com',
    user_metadata: { role: 'parent' }
  };

  const mockSession = {
    user: mockUser,
    access_token: 'test-token'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authChangeCallback = null;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Initial State', () => {
    it('should start with loading state', async () => {
      mockSupabase.auth.getSession.mockResolvedValue({
        data: { session: null }
      });

      const { result } = renderHook(() => useAuth());

      expect(result.current.loading).toBe(true);
      expect(result.current.user).toBe(null);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('should set user when session exists', async () => {
      mockSupabase.auth.getSession.mockResolvedValue({
        data: { session: mockSession }
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.user).toEqual(mockUser);
    });

    it('should set user to null when no session', async () => {
      mockSupabase.auth.getSession.mockResolvedValue({
        data: { session: null }
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.user).toBe(null);
    });
  });

  describe('Auth State Change', () => {
    it('should update user on sign in', async () => {
      mockSupabase.auth.getSession.mockResolvedValue({
        data: { session: null }
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.user).toBe(null);

      // Simulate sign in
      act(() => {
        if (authChangeCallback) {
          authChangeCallback('SIGNED_IN', mockSession);
        }
      });

      expect(result.current.user).toEqual(mockUser);
    });

    it('should update user on sign out', async () => {
      mockSupabase.auth.getSession.mockResolvedValue({
        data: { session: mockSession }
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.user).toEqual(mockUser);
      });

      // Simulate sign out
      act(() => {
        if (authChangeCallback) {
          authChangeCallback('SIGNED_OUT', null);
        }
      });

      expect(result.current.user).toBe(null);
    });

    it('should handle token refresh', async () => {
      mockSupabase.auth.getSession.mockResolvedValue({
        data: { session: mockSession }
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.user).toEqual(mockUser);
      });

      const newSession = {
        ...mockSession,
        access_token: 'new-token'
      };

      // Simulate token refresh
      act(() => {
        if (authChangeCallback) {
          authChangeCallback('TOKEN_REFRESHED', newSession);
        }
      });

      expect(result.current.user).toEqual(mockUser);
    });
  });

  describe('Sign Out', () => {
    it('should call supabase signOut', async () => {
      mockSupabase.auth.getSession.mockResolvedValue({
        data: { session: mockSession }
      });
      mockSupabase.auth.signOut.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.signOut();
      });

      expect(mockSupabase.auth.signOut).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cleanup', () => {
    it('should unsubscribe on unmount', async () => {
      mockSupabase.auth.getSession.mockResolvedValue({
        data: { session: null }
      });

      const { unmount } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(mockSupabase.auth.onAuthStateChange).toHaveBeenCalled();
      });

      unmount();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });
});
