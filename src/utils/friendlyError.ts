/**
 * Maps raw/technical error messages to user-friendly text.
 * 
 * Usage:
 *   showToast(friendlyError(error.message, 'update profile'), 'error');
 *   setError(friendlyError(err.message));
 */

/**
 * Known technical error patterns → friendly replacements.
 * Order matters: first match wins.
 */
const ERROR_MAP: Array<{ pattern: RegExp; friendly: string }> = [
  // ── Network / connectivity ──
  { pattern: /failed to fetch|networkerror|network request failed|fetch.*failed/i, friendly: 'Unable to connect. Please check your internet and try again.' },
  { pattern: /load failed/i, friendly: 'Connection interrupted. Please try again.' },
  { pattern: /timeout|timed out|aborted/i, friendly: 'The request took too long. Please try again.' },
  { pattern: /no internet|offline/i, friendly: 'You appear to be offline. Please check your connection.' },
  { pattern: /502|503|504/i, friendly: 'The server is temporarily unavailable. Please try again in a moment.' },

  // ── Auth / session ──
  { pattern: /jwt expired|token.*expired|invalid.*token|invalid claim/i, friendly: 'Your session has expired. Please sign in again.' },
  { pattern: /user not authenticated|not authenticated|auth.*required/i, friendly: 'Please sign in to continue.' },
  { pattern: /invalid login credentials/i, friendly: 'Invalid email or password.' },
  { pattern: /email not confirmed/i, friendly: 'Please verify your email address first.' },
  { pattern: /user already registered/i, friendly: 'An account with this email already exists.' },
  { pattern: /password should be/i, friendly: 'Password does not meet the requirements. Please choose a stronger password.' },
  { pattern: /rate limit|too many requests|over_request_rate_limit/i, friendly: 'Too many attempts. Please wait a moment and try again.' },
  { pattern: /signups.*disabled/i, friendly: 'Registration is currently disabled. Please contact the administrator.' },

  // ── Database / Supabase ──
  { pattern: /row-level security|rls/i, friendly: "You don't have permission to perform this action." },
  { pattern: /duplicate key.*unique/i, friendly: 'This record already exists. Please check and try again.' },
  { pattern: /violates foreign key/i, friendly: 'This action references data that no longer exists.' },
  { pattern: /violates not-null/i, friendly: 'Some required information is missing. Please fill in all fields.' },
  { pattern: /violates check constraint/i, friendly: 'The provided value is not valid. Please check your input.' },
  { pattern: /relation.*does not exist|column.*does not exist/i, friendly: 'Something went wrong on our end. Please try again later.' },
  { pattern: /PGRST\d+/i, friendly: 'Something went wrong loading data. Please refresh and try again.' },

  // ── Edge Function ──
  { pattern: /edge function returned a non-2xx/i, friendly: 'The server encountered an error. Please try again.' },
  { pattern: /edge function.*boot error|edge function.*crashed/i, friendly: 'A server error occurred. Please try again in a moment.' },
  { pattern: /function.*not found/i, friendly: 'This feature is temporarily unavailable. Please try again later.' },

  // ── Storage ──
  { pattern: /bucket.*not found/i, friendly: 'Image upload is temporarily unavailable.' },
  { pattern: /payload too large|entity too large/i, friendly: 'The file is too large. Please choose a smaller file.' },
  { pattern: /mime type|unsupported.*type/i, friendly: 'This file type is not supported. Please use JPEG, PNG, or WebP.' },

  // ── Business logic (from edge functions) ──
  { pattern: /insufficient.*balance/i, friendly: 'Insufficient balance. Please top up your wallet or choose another payment method.' },
  { pattern: /out of stock|insufficient stock/i, friendly: 'Some items are out of stock. Please update your order.' },
  { pattern: /order.*cutoff|ordering.*closed|past.*cutoff/i, friendly: 'Ordering is closed for this time period. Please try again later.' },
  { pattern: /already.*cancelled|already.*completed|already.*refunded/i, friendly: 'This order has already been processed and cannot be changed.' },
  { pattern: /student.*not found|student.*not linked/i, friendly: 'Student not found. Please check the student ID and try again.' },
  { pattern: /invalid.*invitation|invitation.*not found|invitation.*expired/i, friendly: 'This invitation code is invalid or has expired.' },
  { pattern: /invitation.*already.*used/i, friendly: 'This invitation code has already been used.' },
];

/**
 * Convert a raw error message to a user-friendly one.
 *
 * @param raw      The raw error string (e.g. error.message)
 * @param context  Optional context for a better fallback (e.g. 'place your order')
 * @returns        A user-friendly message, never undefined
 */
export function friendlyError(raw: unknown, context?: string): string {
  // Normalise input
  const message = typeof raw === 'string' ? raw : (raw instanceof Error ? raw.message : '');

  if (!message) {
    return context
      ? `Something went wrong. Please try again.`
      : 'Something went wrong. Please try again.';
  }

  // Check known patterns
  for (const { pattern, friendly } of ERROR_MAP) {
    if (pattern.test(message)) {
      return friendly;
    }
  }

  // If the message already looks user-friendly (no code jargon), pass it through.
  // Heuristic: if it's short, has no stack traces, no code identifiers, keep it.
  if (isAlreadyFriendly(message)) {
    return message;
  }

  // Fallback: use context if provided, otherwise generic.
  return context
    ? `Unable to ${context}. Please try again.`
    : 'Something went wrong. Please try again.';
}

/**
 * Heuristic: detect messages that are already user-readable.
 * Returns false for messages with code-smell (stack traces, field names, SQL, etc.)
 */
function isAlreadyFriendly(msg: string): boolean {
  // Definitely technical
  if (/\b(sql|pgrst|constraint|relation|column|schema|query|function|index|supabase|deno)\b/i.test(msg)) return false;
  if (/\b(error_code|stack|at\s+\w+\.\w+|TypeError|ReferenceError|SyntaxError)\b/.test(msg)) return false;
  if (/\{.*\}/.test(msg)) return false; // Contains JSON objects
  if (msg.length > 200) return false; // Too long = probably technical
  // Likely friendly
  return true;
}

/**
 * Helper to extract error message from unknown catch value.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
}
