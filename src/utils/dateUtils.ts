/**
 * Shared date utilities using Asia/Manila timezone consistently.
 * Extracted to avoid duplication across useCart, products.ts, and other files.
 */

/**
 * Formats a Date as 'YYYY-MM-DD' in Asia/Manila timezone.
 * This is the canonical formatter for Philippine-timezone dates.
 */
export function formatDateLocal(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

/**
 * Returns today's date string in 'YYYY-MM-DD' format, anchored to Asia/Manila timezone.
 */
export function getTodayLocal(): string {
  return formatDateLocal(new Date());
}
