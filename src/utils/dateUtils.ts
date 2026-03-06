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
 * Returns tomorrow's date string in 'YYYY-MM-DD' format, anchored to Asia/Manila timezone.
 * Safer than date-fns isTomorrow() which uses the browser's local timezone.
 */
export function getTomorrowLocal(): string {
  const today = new Date(getTodayLocal() + 'T00:00:00');
  today.setDate(today.getDate() + 1);
  return formatDateLocal(today);
}

/**
 * Returns the Monday of the week containing the given Manila date string.
 * Safe to use with Manila-anchored YYYY-MM-DD strings — avoids browser-timezone
 * getDay() pitfalls that can occur when calling .getDay() on a raw Date.
 */
export function getMondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0 = Sun, 1 = Mon… (safe: input is a Manila YYYY-MM-DD)
  const diff = day === 0 ? -6 : 1 - day; // Mon = 0 offset, others negative
  d.setDate(d.getDate() + diff);
  return formatDateLocal(d);
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
 * Returns an array of date strings for the given week.
 * @param weekStart Monday YYYY-MM-DD string.
 * @param days Number of days to include (default 5 = Mon–Fri, 6 = Mon–Sat).
 */
export function getWeekDates(weekStart: string, days = 5): string[] {
  const monday = new Date(weekStart + 'T00:00:00');
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
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
  // Coerce cutoffDay to a valid number (DB may store a string day-name)
  let dayNum = typeof cutoffDay === 'number' ? cutoffDay : DEFAULT_CUTOFF_DAY;
  if (isNaN(dayNum) || dayNum < 0 || dayNum > 6) dayNum = DEFAULT_CUTOFF_DAY;

  // targetWeekStart is always a Monday (day 1).
  // We want the cutoff day of the PREVIOUS week, e.g. Friday (5) = Monday - 3.
  // Formula: daysOffset = cutoffDay - 8  (always negative: Fri → 5-8=-3)
  const daysOffset = dayNum - 8;

  // Use noon Manila time as reference to avoid midnight DST/boundary edge cases.
  const mondayMs = new Date(targetWeekStart + 'T12:00:00+08:00').getTime();
  const cutoffMs = mondayMs + daysOffset * 24 * 60 * 60 * 1000;
  const cutoffDateStr = new Date(cutoffMs).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

  const parts = (cutoffTime || '17:00').split(':').map(Number);
  const hh = String(isNaN(parts[0]) ? DEFAULT_CUTOFF_HOUR : parts[0]).padStart(2, '0');
  const mm = String(isNaN(parts[1]) ? DEFAULT_CUTOFF_MINUTE : parts[1]).padStart(2, '0');

  // Construct as an explicit Manila-timezone ISO string to avoid any UTC/local mixing.
  return new Date(`${cutoffDateStr}T${hh}:${mm}:00+08:00`);
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
 * @param days Number of days in the week (default 5 = Mon–Fri, 6 = Mon–Sat).
 */
export function getWeekLabel(weekStart: string, days = 5): string {
  const monday = new Date(weekStart + 'T00:00:00');
  const lastDay = new Date(monday);
  lastDay.setDate(monday.getDate() + days - 1);

  const monMonth = monday.toLocaleDateString('en-US', { month: 'short' });
  const lastMonth = lastDay.toLocaleDateString('en-US', { month: 'short' });
  const year = monday.getFullYear();
  const monDay = monday.getDate();
  const lastDayNum = lastDay.getDate();

  if (monMonth === lastMonth) {
    return `${monMonth} ${monDay}–${lastDayNum}, ${year}`;
  }
  return `${monMonth} ${monDay} – ${lastMonth} ${lastDayNum}, ${year}`;
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
