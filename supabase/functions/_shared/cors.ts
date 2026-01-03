/**
 * Shared CORS utilities for Supabase Edge Functions
 * 
 * Best Practices:
 * - Never reflect arbitrary origins back
 * - Use exact origin matching for production
 * - Wildcard (*) only for development
 * - Set Vary: Origin when dynamic origins are used
 */

// Parse allowed origins from environment variable
// Format: "https://example.com,https://app.example.com"
const ALLOWED_ORIGINS: string[] = (() => {
  const origins = Deno.env.get('ALLOWED_ORIGINS');
  if (origins) {
    return origins.split(',').map(o => o.trim()).filter(Boolean);
  }
  // Default allowed origins (production + development)
  return [
    'https://canteen-pwa.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000'
  ];
})();

/**
 * Validates if an origin is allowed
 */
function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes('*')) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

/**
 * Get CORS headers for a request
 * Security: Only returns the request origin if it's in the allowed list
 */
export function getCorsHeaders(origin: string | null): Record<string, string> {
  // If wildcard is configured, allow all
  if (ALLOWED_ORIGINS.includes('*')) {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    };
  }

  // Only reflect origin if it's explicitly allowed
  if (origin && isOriginAllowed(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Credentials': 'true',
      'Vary': 'Origin', // Important for caching when using dynamic origins
    };
  }

  // Origin not allowed - return headers without Allow-Origin
  // This will cause CORS to fail on the client side
  return {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Vary': 'Origin',
  };
}

/**
 * Handle CORS preflight (OPTIONS) requests
 */
export function handleCorsPrefllight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;

  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  // If origin is not allowed, return 403
  if (!corsHeaders['Access-Control-Allow-Origin'] && !ALLOWED_ORIGINS.includes('*')) {
    return new Response('Origin not allowed', { 
      status: 403, 
      headers: corsHeaders 
    });
  }

  return new Response(null, { 
    status: 204, // No Content is proper for preflight
    headers: corsHeaders 
  });
}

/**
 * Create a JSON response with proper CORS headers
 */
export function jsonResponse(
  data: unknown, 
  status: number, 
  origin: string | null
): Response {
  const corsHeaders = getCorsHeaders(origin);
  return new Response(
    JSON.stringify(data),
    { 
      status, 
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'application/json' 
      } 
    }
  );
}

/**
 * Create an error response with proper CORS headers
 */
export function errorResponse(
  error: string, 
  status: number, 
  origin: string | null
): Response {
  return jsonResponse({ error }, status, origin);
}
