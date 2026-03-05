/**
 * Shared date utilities using Asia/Manila timezone consistently.
 * Extracted to avoid duplication across useCart, products.ts, and other files.
 *
 * All weekly pre-ordering logic uses these canonical helpers.
 */

// ── Core formatters ──

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

/**
 * Get the current Manila time components.
 */
function getManilaTime(date: Date = new Date()): { hours: number; minutes: number; dayOfWeek: number; dateStr: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    hour: 'numeric', minute: 'numeric', hour12: false,
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const hours = parseInt(get('hour'), 10);
  const minutes = parseInt(get('minute'), 10);
  const dateStr = formatDateLocal(date);
  const dayNames: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = dayNames[get('weekday')] ?? new Date(dateStr).getDay();
  return { hours, minutes, dayOfWeek, dateStr };
}

// ── Weekly ordering helpers ──

/** Default cutoff: Friday at 17:00 (5 PM Manila) */
const DEFAULT_CUTOFF_DAY = 5; // Friday
const DEFAULT_CUTOFF_HOUR = 17;
const DEFAULT_CUTOFF_MINUTE = 0;

/** Default surplus cutoff: 8:00 AM Manila */
const DEFAULT_SURPLUS_CUTOFF_HOUR = 8;
const DEFAULT_SURPLUS_CUTOFF_MINUTE = 0;

/** Default daily cancellation cutoff: 8:00 AM Manila */
const DEFAULT_CANCEL_CUTOFF_HOUR = 8;
const DEFAULT_CANCEL_CUTOFF_MINUTE = 0;

/**
 * Returns the Monday (YYYY-MM-DD) of the week that parents should be ordering for.
 *
 * Before cutoff (default Fri 5 PM) → the coming Monday (next week's Monday).
 * After cutoff → the Monday two weeks out.
 *
 * @param cutoffDay   Day of week for cutoff (0=Sun..6=Sat). Default 5 (Friday).
 * @param cutoffTime  'HH:MM' 24h format. Default '17:00'.
 */
export function getNextOrderableWeek(
  cutoffDay = DEFAULT_CUTOFF_DAY,
  cutoffTime = `${DEFAULT_CUTOFF_HOUR}:${String(DEFAULT_CUTOFF_MINUTE).padStart(2, '0')}`,
): string {
  const { hours, minutes, dayOfWeek, dateStr } = getManilaTime();
  const [cHour, cMin] = cutoffTime.split(':').map(Number);

  // Is cutoff already passed this week?
  const pastCutoff =
    dayOfWeek > cutoffDay ||
    (dayOfWeek === cutoffDay && (hours > cHour || (hours === cHour && minutes >= cMin)));

  // Next Monday from today
  const today = new Date(dateStr + 'T00:00:00');
  const daysUntilMonday = ((8 - today.getDay()) % 7) || 7; // 1..7
  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() + daysUntilMonday);

  if (pastCutoff) {
    // Skip to the Monday after next
    nextMonday.setDate(nextMonday.getDate() + 7);
  }

  return formatDateLocal(nextMonday);
}

/**
 * Returns an array of Mon–Fri date strings for the given week.
 * @param weekStart Monday YYYY-MM-DD string.
 */
export function getWeekDates(weekStart: string): string[] {
  const monday = new Date(weekStart + 'T00:00:00');
  const dates: string[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(formatDateLocal(d));
  }
  return dates;
}

/**
 * Returns the cutoff deadline (Date) for a given target week.
 * Cutoff is on the Friday BEFORE the target week's Monday, at 5 PM Manila.
 *
 * @param targetWeekStart Monday YYYY-MM-DD of the target week.
 * @param cutoffDay   Day of week (0-6). Default 5 (Friday).
 * @param cutoffTime  'HH:MM'. Default '17:00'.
 */
export function getWeeklyCutoffDeadline(
  targetWeekStart: string,
  cutoffDay = DEFAULT_CUTOFF_DAY,
  cutoffTime = `${DEFAULT_CUTOFF_HOUR}:${String(DEFAULT_CUTOFF_MINUTE).padStart(2, '0')}`,
): Date {
  const monday = new Date(targetWeekStart + 'T00:00:00');
  // Go back to the previous week's cutoff day
  // Monday (1) - cutoffDay (5) = -4 → previous Friday
  const diff = cutoffDay - monday.getDay(); // e.g. 5 - 1 = 4
  const cutoffDate = new Date(monday);
  cutoffDate.setDate(monday.getDate() + diff - 7); // subtract 7 to get previous week

  const [h, m] = cutoffTime.split(':').map(Number);
  // Return as a Manila-time-equivalent UTC Date
  // Manila is UTC+8, so subtract 8 hours from Manila time to get UTC
  cutoffDate.setUTCHours(h - 8, m, 0, 0);
  return cutoffDate;
}

/**
 * Check if the weekly cutoff has passed for the given target week.
 */
export function isCutoffPassed(
  targetWeekStart: string,
  cutoffDay?: number,
  cutoffTime?: string,
): boolean {
  const deadline = getWeeklyCutoffDeadline(targetWeekStart, cutoffDay, cutoffTime);
  return new Date() >= deadline;
}

/**
 * Returns countdown { days, hours, minutes, seconds } until the weekly cutoff.
 * Returns all zeros if cutoff has passed.
 */
export function getCutoffCountdown(
  targetWeekStart: string,
  cutoffDay?: number,
  cutoffTime?: string,
): { days: number; hours: number; minutes: number; seconds: number } {
  const deadline = getWeeklyCutoffDeadline(targetWeekStart, cutoffDay, cutoffTime);
  const diff = deadline.getTime() - Date.now();

  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };

  const totalSec = Math.floor(diff / 1000);
  return {
    days: Math.floor(totalSec / 86400),
    hours: Math.floor((totalSec % 86400) / 3600),
    minutes: Math.floor((totalSec % 3600) / 60),
    seconds: totalSec % 60,
  };
}

/**
 * Check if the surplus ordering cutoff has passed for today.
 * Surplus orders are only accepted until 8:00 AM Manila time.
 */
export function isSurplusCutoffPassed(
  cutoffHour = DEFAULT_SURPLUS_CUTOFF_HOUR,
  cutoffMinute = DEFAULT_SURPLUS_CUTOFF_MINUTE,
): boolean {
  const { hours, minutes } = getManilaTime();
  return hours > cutoffHour || (hours === cutoffHour && minutes >= cutoffMinute);
}

/**
 * Check if the daily cancellation cutoff has passed for a given date.
 * Parents can cancel individual days until 8:00 AM of that day.
 */
export function isDailyCancelCutoffPassed(
  date: string,
  cutoffHour = DEFAULT_CANCEL_CUTOFF_HOUR,
  cutoffMinute = DEFAULT_CANCEL_CUTOFF_MINUTE,
): boolean {
  const todayStr = getTodayLocal();

  // If the date is in the past, cutoff has definitely passed
  if (date < todayStr) return true;

  // If the date is in the future, cutoff hasn't passed yet
  if (date > todayStr) return false;

  // Same day — check time
  const { hours, minutes } = getManilaTime();
  return hours > cutoffHour || (hours === cutoffHour && minutes >= cutoffMinute);
}

/**
 * Formatted week label: "Mar 2–6, 2026"
 */
export function getWeekLabel(weekStart: string): string {
  const monday = new Date(weekStart + 'T00:00:00');
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  const monMonth = monday.toLocaleDateString('en-US', { month: 'short' });
  const friMonth = friday.toLocaleDateString('en-US', { month: 'short' });
  const year = monday.getFullYear();
  const monDay = monday.getDate();
  const friDay = friday.getDate();

  if (monMonth === friMonth) {
    return `${monMonth} ${monDay}–${friDay}, ${year}`;
  }
  return `${monMonth} ${monDay} – ${friMonth} ${friDay}, ${year}`;
}

/**
 * ISO week number for a given date (for grouping/reporting).
 */
export function getWeekNumber(date: string): number {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

/**
 * Day-of-week label for a date string: "Monday", "Tuesday", etc.
 */
export function getDayOfWeekLabel(date: string): string {
  const d = new Date(date + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}
