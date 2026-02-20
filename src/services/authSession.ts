/**
 * Centralized Auth Session Manager
 * 
 * This module provides a single source of truth for session access,
 * preventing race conditions from multiple independent getSession() calls.
 * All components and services should use these utilities instead of
 * calling supabase.auth.getSession() directly.
 */
/* eslint-disable no-console */

import { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

// ─── Types ──────────────────────────────────────────────────────────
export interface SessionResult {
  session: Session | null;
  user: User | null;
  error: Error | null;
}

export interface TokenResult {
  accessToken: string | null;
  error: Error | null;
}

// ─── Session State ──────────────────────────────────────────────────
let cachedSession: Session | null = null;
let sessionPromise: Promise<SessionResult> | null = null;
let lastRefreshTime = 0;
const SESSION_CACHE_TTL = 30_000; // 30 seconds cache TTL

// ─── Event Emitter for Session Changes ──────────────────────────────
type SessionChangeCallback = (session: Session | null) => void;
const sessionChangeListeners = new Set<SessionChangeCallback>();

export function onSessionChange(callback: SessionChangeCallback): () => void {
  sessionChangeListeners.add(callback);
  return () => sessionChangeListeners.delete(callback);
}

function notifySessionChange(session: Session | null): void {
  sessionChangeListeners.forEach(cb => {
    try {
      cb(session);
    } catch (err) {
      console.error('[AuthSession] Listener error:', err);
    }
  });
}

// ─── Cache Management ───────────────────────────────────────────────
/**
 * Update the cached session. Called by AuthProvider on auth state changes.
 */
export function updateCachedSession(session: Session | null): void {
  cachedSession = session;
  lastRefreshTime = Date.now();
  notifySessionChange(session);
}

/**
 * Clear cached session. Called on sign out or session invalidation.
 */
export function clearCachedSession(): void {
  cachedSession = null;
  sessionPromise = null;
  lastRefreshTime = 0;
  notifySessionChange(null);
}

/**
 * Check if cached session is still considered fresh.
 */
function isCacheFresh(): boolean {
  return cachedSession !== null && (Date.now() - lastRefreshTime) < SESSION_CACHE_TTL;
}

// ─── Session Access ─────────────────────────────────────────────────
/**
 * Get the current session. Uses cached session if fresh, otherwise fetches.
 * Deduplicates concurrent requests to prevent race conditions.
 */
export async function getSession(): Promise<SessionResult> {
  // Return cached session if fresh
  if (isCacheFresh() && cachedSession) {
    return {
      session: cachedSession,
      user: cachedSession.user,
      error: null
    };
  }

  // Deduplicate concurrent requests
  if (sessionPromise) {
    return sessionPromise;
  }

  sessionPromise = (async (): Promise<SessionResult> => {
    try {
      const { data, error } = await supabase.auth.getSession();
      
      if (error) {
        return { session: null, user: null, error };
      }

      if (data.session) {
        cachedSession = data.session;
        lastRefreshTime = Date.now();
      }

      return {
        session: data.session,
        user: data.session?.user ?? null,
        error: null
      };
    } catch (err) {
      return {
        session: null,
        user: null,
        error: err instanceof Error ? err : new Error('Failed to get session')
      };
    } finally {
      // Clear promise after a short delay to allow deduplication window
      setTimeout(() => {
        sessionPromise = null;
      }, 100);
    }
  })();

  return sessionPromise;
}

/**
 * Get access token for API calls. Returns null if not authenticated.
 * This is the preferred method for services making API calls.
 */
export async function getAccessToken(): Promise<TokenResult> {
  const { session, error } = await getSession();
  
  if (error) {
    return { accessToken: null, error };
  }

  if (!session?.access_token) {
    return { 
      accessToken: null, 
      error: new Error('Not authenticated') 
    };
  }

  return { accessToken: session.access_token, error: null };
}

/**
 * Get access token or throw if not authenticated.
 * Use this in contexts where authentication is required.
 */
export async function requireAccessToken(): Promise<string> {
  const { accessToken, error } = await getAccessToken();
  
  if (error) {
    throw error;
  }

  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  return accessToken;
}

/**
 * Get current user or null. Does not throw.
 */
export async function getCurrentUser(): Promise<User | null> {
  const { user } = await getSession();
  return user;
}

/**
 * Check if user is currently authenticated.
 */
export async function isAuthenticated(): Promise<boolean> {
  const { session } = await getSession();
  return session !== null;
}

// ─── Session Validation ─────────────────────────────────────────────
/**
 * Force refresh session from server. Use when session may be stale
 * (e.g., app resume, visibility change).
 */
export async function refreshSession(): Promise<SessionResult> {
  // Clear cache to force fresh fetch
  sessionPromise = null;
  lastRefreshTime = 0;

  try {
    // First get session, then validate with getUser()
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      clearCachedSession();
      return { session: null, user: null, error: sessionError };
    }

    if (!sessionData.session) {
      clearCachedSession();
      return { session: null, user: null, error: null };
    }

    // Validate session is still valid on server
    const { data: userData, error: userError } = await supabase.auth.getUser();
    
    if (userError) {
      // Session exists locally but is invalid on server
      console.warn('[AuthSession] Session invalid on server, clearing...');
      clearCachedSession();
      await supabase.auth.signOut();
      return { 
        session: null, 
        user: null, 
        error: new Error('Session expired. Please sign in again.') 
      };
    }

    // Update cache with fresh data
    cachedSession = sessionData.session;
    lastRefreshTime = Date.now();

    return {
      session: sessionData.session,
      user: userData.user,
      error: null
    };
  } catch (err) {
    return {
      session: cachedSession, // Return cached as fallback
      user: cachedSession?.user ?? null,
      error: err instanceof Error ? err : new Error('Failed to refresh session')
    };
  }
}

/**
 * Validate session and check for role changes.
 * Returns the fresh user with updated metadata.
 */
export async function validateSessionAndRole(): Promise<{
  user: User | null;
  roleChanged: boolean;
  previousRole: string | null;
  currentRole: string | null;
  error: Error | null;
}> {
  const previousRole = cachedSession?.user?.app_metadata?.role ?? null;

  const { user, error } = await refreshSession();

  if (error || !user) {
    return {
      user: null,
      roleChanged: false,
      previousRole,
      currentRole: null,
      error
    };
  }

  const currentRole = user.app_metadata?.role ?? null;
  const roleChanged = previousRole !== null && currentRole !== previousRole;

  return {
    user,
    roleChanged,
    previousRole,
    currentRole,
    error: null
  };
}

// ─── Cached User from Storage (Fallback) ────────────────────────────
/**
 * Read cached user from localStorage for immediate routing decisions.
 * Only use as timeout fallback - actual API calls should use getSession().
 */
export function getCachedUserFromStorage(): User | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed?.user) return parsed.user as User;
      }
    }
  } catch {
    // Corrupted storage
  }
  return null;
}

/**
 * Clear all Supabase auth storage (for clean logout/reload).
 */
export function clearAuthStorage(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch {
    // Storage may be unavailable
  }
}

// ─── Service Helpers ────────────────────────────────────────────────
const TOKEN_REFRESH_THRESHOLD_MS = 120_000; // Refresh if expires within 2 minutes

/**
 * Ensure we have a valid session for API calls.
 * Automatically refreshes token if it's about to expire.
 * Throws if not authenticated.
 * 
 * Use this in services instead of supabase.auth.getSession() directly.
 */
export async function ensureValidSession(): Promise<Session> {
  const { session, error } = await getSession();
  
  if (error) {
    throw new Error('Please sign in again');
  }

  if (!session) {
    throw new Error('Please sign in to continue');
  }

  // Check if token is about to expire
  const expiresAt = session.expires_at;
  if (expiresAt && expiresAt * 1000 - Date.now() < TOKEN_REFRESH_THRESHOLD_MS) {
    console.log('[AuthSession] Token expiring soon, refreshing...');
    
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    
    if (refreshError) {
      clearCachedSession();
      throw new Error('Session expired. Please sign in again.');
    }
    
    if (!refreshData.session) {
      clearCachedSession();
      throw new Error('Failed to refresh session. Please sign in again.');
    }
    
    // Update cache with refreshed session
    cachedSession = refreshData.session;
    lastRefreshTime = Date.now();
    
    return refreshData.session;
  }

  return session;
}

/**
 * Ensure valid session and return access token.
 * Throws if not authenticated.
 */
export async function ensureValidAccessToken(): Promise<string> {
  const session = await ensureValidSession();
  return session.access_token;
}
