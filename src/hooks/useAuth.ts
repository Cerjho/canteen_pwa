import { useEffect, useState, useCallback, useRef } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';

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

    // Hard timeout — never block the app for more than 5 seconds
    const timeout = setTimeout(() => {
      if (isMounted) finishLoading();
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