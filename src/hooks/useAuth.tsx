/* eslint-disable react-refresh/only-export-components */
/* eslint-disable no-console */
import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { User, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';
import {
  updateCachedSession,
  clearCachedSession,
  getCachedUserFromStorage,
  validateSessionAndRole,
  clearAuthStorage
} from '../services/authSession';

// ─── Types ──────────────────────────────────────────────────────────
export type UserRole = 'admin' | 'staff' | 'parent';

interface RoleChangeInfo {
  previousRole: UserRole | null;
  currentRole: UserRole | null;
}

interface AuthContextValue {
  user: User | null;
  role: UserRole;
  loading: boolean;
  signingOut: boolean;
  error: Error | null;
  signOut: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  onRoleChange: (callback: (info: RoleChangeInfo) => void) => () => void;
}

// ─── Role Change Event Emitter ──────────────────────────────────────
type RoleChangeCallback = (info: RoleChangeInfo) => void;
const roleChangeListeners = new Set<RoleChangeCallback>();

function notifyRoleChange(info: RoleChangeInfo): void {
  roleChangeListeners.forEach(cb => {
    try {
      cb(info);
    } catch (err) {
      console.error('[Auth] Role change listener error:', err);
    }
  });
}

// ─── Context ────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Configuration ──────────────────────────────────────────────────
const AUTH_TIMEOUT_MS = 5000; // Max time to wait for initial auth
const VISIBILITY_REFRESH_DELAY_MS = 500; // Debounce visibility change refresh

// ─── Provider (mount ONCE near the root) ────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const loadingResolved = useRef(false);
  const lastKnownRole = useRef<UserRole | null>(null);
  const visibilityRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Computed role from user metadata
  const role: UserRole = (user?.app_metadata?.role as UserRole) || 'parent';

  // Helper: mark loading done (idempotent)
  const finishLoading = useCallback(() => {
    if (!loadingResolved.current) {
      loadingResolved.current = true;
      setLoading(false);
    }
  }, []);

  // Helper: update user and track role changes
  const updateUser = useCallback((newUser: User | null) => {
    setUser(prevUser => {
      const prevRole = (prevUser?.app_metadata?.role as UserRole) || null;
      const newRole = (newUser?.app_metadata?.role as UserRole) || null;

      // Detect role changes (only when both are defined)
      if (prevRole !== null && newRole !== null && prevRole !== newRole) {
        console.log('[Auth] Role changed:', prevRole, '->', newRole);
        notifyRoleChange({ previousRole: prevRole, currentRole: newRole });
      }

      lastKnownRole.current = newRole;
      return newUser;
    });
  }, []);

  // Refresh auth state (can be called manually or on visibility change)
  const refreshAuth = useCallback(async () => {
    try {
      const result = await validateSessionAndRole();
      
      if (result.error) {
        // Session is invalid - clear state
        if (result.error.message.includes('expired') || result.error.message.includes('invalid')) {
          updateUser(null);
          setError(result.error);
        }
        return;
      }

      if (result.roleChanged) {
        console.log('[Auth] Role changed during refresh:', result.previousRole, '->', result.currentRole);
        notifyRoleChange({
          previousRole: result.previousRole as UserRole | null,
          currentRole: result.currentRole as UserRole | null
        });
      }

      updateUser(result.user);
      setError(null);
    } catch (err) {
      console.error('[Auth] Refresh failed:', err);
      // Don't clear user on network errors - keep cached state
    }
  }, [updateUser]);

  // Handle visibility change (app resume)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && user) {
        // Debounce to prevent rapid refreshes
        if (visibilityRefreshTimer.current) {
          clearTimeout(visibilityRefreshTimer.current);
        }
        visibilityRefreshTimer.current = setTimeout(() => {
          refreshAuth();
        }, VISIBILITY_REFRESH_DELAY_MS);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (visibilityRefreshTimer.current) {
        clearTimeout(visibilityRefreshTimer.current);
      }
    };
  }, [user, refreshAuth]);

  // Main auth initialization effect
  useEffect(() => {
    let isMounted = true;

    // Hard timeout — never block the app for more than AUTH_TIMEOUT_MS.
    // When this fires, auth.getSession() is likely stuck behind the
    // global lock waiting for _callRefreshToken() to complete.
    const timeout = setTimeout(() => {
      if (isMounted && !loadingResolved.current) {
        console.warn('[Auth] Timeout reached, using cached user');
        const cached = getCachedUserFromStorage();
        if (cached) {
          updateUser(cached);
        }
        finishLoading();
      }
    }, AUTH_TIMEOUT_MS);

    // Get session from local storage (fast, no network call)
    supabase.auth.getSession()
      .then(async ({ data: { session }, error: sessionError }) => {
        if (!isMounted) return;
        
        if (sessionError) {
          setError(sessionError);
          finishLoading();
          return;
        }

        if (session?.user) {
          // Update centralized cache
          updateCachedSession(session);
          
          // Use session user IMMEDIATELY so loading finishes fast
          updateUser(session.user);
          finishLoading();
          
          // Then refresh in background for fresh app_metadata (role)
          try {
            const { data: { user: freshUser }, error: userError } = await supabase.auth.getUser();
            
            if (userError) {
              // Session exists but is invalid on server
              console.warn('[Auth] Session invalid on server:', userError.message);
              if (isMounted) {
                // Keep the user logged in with cached data, but mark error
                setError(new Error('Session may be stale. Refresh recommended.'));
              }
              return;
            }
            
            if (isMounted && freshUser) {
              updateUser(freshUser);
              setError(null);
            }
          } catch {
            // Network error - keep session user, this is acceptable
          }
        } else {
          updateUser(null);
          clearCachedSession();
          finishLoading();
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err instanceof Error ? err : new Error('Failed to get session'));
        finishLoading();
      });

    // Listen for auth changes (SINGLE listener for the whole app)
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, session) => {
      if (!isMounted) return;
      
      console.log('[Auth] State change:', event);
      
      // Update centralized cache
      updateCachedSession(session);
      
      if (session?.user) {
        // Set session user immediately
        updateUser(session.user);
        setError(null);
        finishLoading();
        
        // For SIGNED_IN events, fetch fresh user data
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          try {
            const { data: { user: freshUser }, error: userError } = await supabase.auth.getUser();
            
            if (userError) {
              console.warn('[Auth] Failed to get fresh user:', userError.message);
              return;
            }
            
            if (isMounted && freshUser) {
              updateUser(freshUser);
            }
          } catch {
            // Keep session user on network errors
          }
        }
      } else {
        updateUser(null);
        clearCachedSession();
        setError(null);
        finishLoading();
      }
    });

    return () => {
      isMounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [finishLoading, updateUser]);

  // Sign out with loading state
  const signOut = useCallback(async () => {
    try {
      setSigningOut(true);
      setError(null);
      
      // Brief delay for smoother UX transition
      await new Promise((resolve) => setTimeout(resolve, 400));
      
      // Clear caches before sign out
      clearCachedSession();
      
      await supabase.auth.signOut();
      
      // Clear any remaining storage
      clearAuthStorage();
      
      updateUser(null);
    } catch (err) {
      console.error('[Auth] Sign out error:', err);
      setError(err instanceof Error ? err : new Error('Sign out failed'));
      throw err;
    } finally {
      setSigningOut(false);
    }
  }, [updateUser]);

  // Subscribe to role changes
  const onRoleChange = useCallback((callback: RoleChangeCallback) => {
    roleChangeListeners.add(callback);
    return () => roleChangeListeners.delete(callback);
  }, []);

  return (
    <AuthContext.Provider value={{ 
      user, 
      role,
      loading, 
      signingOut,
      error, 
      signOut,
      refreshAuth,
      onRoleChange
    }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook (reads from context — no independent state) ───────────────
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return context;
}

// ─── Utility Hook: Subscribe to role changes with auto-navigation ───
export function useRoleChangeRedirect(navigate: (path: string) => void): void {
  const { onRoleChange, user } = useAuth();

  useEffect(() => {
    if (!user) return;

    const unsubscribe = onRoleChange(({ currentRole }) => {
      if (!currentRole) return;
      
      // Navigate to appropriate dashboard on role change
      switch (currentRole) {
        case 'admin':
          navigate('/admin');
          break;
        case 'staff':
          navigate('/staff');
          break;
        default:
          navigate('/menu');
      }
    });

    return unsubscribe;
  }, [user, onRoleChange, navigate]);
}