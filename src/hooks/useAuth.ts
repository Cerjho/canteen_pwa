import { useEffect, useState, useCallback, useRef } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';

/**
 * Read the cached Supabase session user directly from localStorage,
 * bypassing auth.getSession() which acquires a global lock and may
 * block on a token refresh network call for 10-30 s.
 *
 * This is intentionally used ONLY as a timeout fallback so the app
 * can render immediately with routing decisions (user ≠ null → show
 * protected pages).  All actual API calls still go through the real
 * Supabase client and its lock-protected token refresh flow.
 */
function getCachedUserFromStorage(): User | null {
  try {
    // Supabase stores sessions under  sb-<projectRef>-auth-token
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        // v2 stores { access_token, refresh_token, user, ... } at top level
        if (parsed?.user) return parsed.user as User;
      }
    }
  } catch {
    // Corrupted storage — fall through
  }
  return null;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const loadingResolved = useRef(false);

  // Helper: mark loading done (idempotent)
  const finishLoading = useCallback(() => {
    if (!loadingResolved.current) {
      loadingResolved.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    // Hard timeout — never block the app for more than 5 seconds.
    // When this fires, auth.getSession() is likely stuck behind the
    // global lock waiting for _callRefreshToken() to complete (common
    // after returning from an external redirect like PayMongo where
    // the access_token expired).  Read the user straight from
    // localStorage so the app can route to the correct page.
    const timeout = setTimeout(() => {
      if (isMounted && !loadingResolved.current) {
        const cached = getCachedUserFromStorage();
        if (cached) setUser(cached);
        finishLoading();
      }
    }, 5000);

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
          // Use session user IMMEDIATELY so loading finishes fast
          setUser(session.user);
          finishLoading();
          
          // Then refresh in background for fresh app_metadata (role)
          try {
            const { data: { user: freshUser } } = await supabase.auth.getUser();
            if (isMounted && freshUser) {
              setUser(freshUser);
            }
          } catch {
            // Background refresh failed — session user is fine
          }
        } else {
          setUser(null);
          finishLoading();
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err instanceof Error ? err : new Error('Failed to get session'));
        finishLoading();
      });

    // Listen for auth changes
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!isMounted) return;
      
      if (session?.user) {
        // Set session user immediately
        setUser(session.user);
        setError(null);
        
        // Refresh in background for fresh metadata
        try {
          const { data: { user: freshUser } } = await supabase.auth.getUser();
          if (isMounted && freshUser) {
            setUser(freshUser);
          }
        } catch {
          // Keep session user
        }
      } else {
        setUser(null);
        setError(null);
      }
    });

    return () => {
      isMounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [finishLoading]);

  const signOut = useCallback(async () => {
    try {
      // Brief delay for smoother UX transition
      await new Promise((resolve) => setTimeout(resolve, 600));
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Sign out error:', err);
      throw err;
    }
  }, []);

  return { user, loading, error, signOut };
}