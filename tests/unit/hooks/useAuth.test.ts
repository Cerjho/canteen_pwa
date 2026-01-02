// useAuth Hook Tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// Mock supabase client - functions must be defined before vi.mock due to hoisting
const mockUnsubscribe = vi.fn();
let authChangeCallback: ((event: string, session: { user: unknown; access_token: string } | null) => void) | null = null;
const mockGetSession = vi.fn();
const mockSignOut = vi.fn();

vi.mock('../../../src/services/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      signOut: () => mockSignOut(),
      onAuthStateChange: (callback: (event: string, session: { user: unknown; access_token: string } | null) => void) => {
        authChangeCallback = callback;
        return {
          data: {
            subscription: {
              unsubscribe: mockUnsubscribe
            }
          }
        };
      }
    }
  }
}));

import { useAuth } from '../../../src/hooks/useAuth';

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
      mockGetSession.mockResolvedValue({
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
      mockGetSession.mockResolvedValue({
        data: { session: mockSession }
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.user).toEqual(mockUser);
    });

    it('should set user to null when no session', async () => {
      mockGetSession.mockResolvedValue({
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
      mockGetSession.mockResolvedValue({
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
      mockGetSession.mockResolvedValue({
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
      mockGetSession.mockResolvedValue({
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
      mockGetSession.mockResolvedValue({
        data: { session: mockSession }
      });
      mockSignOut.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.signOut();
      });

      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cleanup', () => {
    it('should unsubscribe on unmount', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null }
      });

      const { unmount } = renderHook(() => useAuth());

      // Wait for hook to initialize
      await waitFor(() => {
        expect(authChangeCallback).not.toBeNull();
      });

      unmount();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });
});
