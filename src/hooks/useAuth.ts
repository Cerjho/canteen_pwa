import { useEffect, useState, useCallback } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;

    // Get initial session, then refresh user from server for fresh app_metadata
    supabase.auth.getSession()
      .then(async ({ data: { session }, error: sessionError }) => {
        if (!isMounted) return;
        
        if (sessionError) {
          console.error('Failed to get session:', sessionError);
          setError(sessionError);
          setLoading(false);
          return;
        }

        if (session?.user) {
          // Fetch fresh user data from server to get updated app_metadata (role)
          const { data: { user: freshUser } } = await supabase.auth.getUser();
          if (isMounted) {
            setUser(freshUser ?? session.user);
          }
        } else {
          setUser(null);
        }
        if (isMounted) setLoading(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error('Session fetch error:', err);
        setError(err instanceof Error ? err : new Error('Failed to get session'));
        setLoading(false);
      });

    // Listen for auth changes - also fetch fresh user data on sign in
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!isMounted) return;
      
      if (session?.user) {
        // On sign-in or token refresh, get fresh user from server
        const { data: { user: freshUser } } = await supabase.auth.getUser();
        if (isMounted) {
          setUser(freshUser ?? session.user);
          setError(null);
        }
      } else {
        setUser(null);
        setError(null);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Sign out error:', err);
      throw err;
    }
  }, []);

  return { user, loading, error, signOut };
}