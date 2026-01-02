import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Validate environment variables at startup
const missingVars: string[] = [];
if (!supabaseUrl) missingVars.push('VITE_SUPABASE_URL');
if (!supabaseAnonKey) missingVars.push('VITE_SUPABASE_ANON_KEY');

if (missingVars.length > 0) {
  const errorMessage = `Missing required environment variables: ${missingVars.join(', ')}. Please check your .env file.`;
  console.error(errorMessage);
  // In development, show a helpful message
  if (import.meta.env.DEV) {
    console.error('Create a .env file with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
  }
}

// Create client even if vars are missing (will fail gracefully on API calls)
export const supabase: SupabaseClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key'
);

// Export URL for service worker and other uses
export const SUPABASE_URL = supabaseUrl || '';
export const SUPABASE_ANON_KEY = supabaseAnonKey || '';

// Helper to check if Supabase is properly configured
export const isSupabaseConfigured = (): boolean => {
  return Boolean(supabaseUrl && supabaseAnonKey);
};

// Cache Supabase URL for service worker access
// Service workers can't access import.meta.env, so we store in Cache API
async function cacheSupabaseUrlForServiceWorker(): Promise<void> {
  if (!supabaseUrl) return;
  
  try {
    const cache = await caches.open('config-cache');
    await cache.put('supabase-url', new Response(supabaseUrl));
  } catch (error) {
    // Cache API might not be available in some contexts
    console.warn('Failed to cache Supabase URL for service worker:', error);
  }
}

// Initialize cache on module load (non-blocking)
if (typeof window !== 'undefined' && 'caches' in window) {
  cacheSupabaseUrlForServiceWorker();
}