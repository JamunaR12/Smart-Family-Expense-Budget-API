import type { BudgetPeriod } from '@prisma/client';

/**
 * A date-only, inclusive `[start, end]` window expressed as `YYYY-MM-DD`
 * strings. Both bounds are calendar days in the configured platform time zone
 * (A3). Because the stored expense `date` is a date-only value, evaluating the
 * window at day granularity avoids any timezone-shift ambiguity, and the
 * `YYYY-MM-DD` strings compare lexicographically in chronological order.
 */
export interface PeriodWindow {
  /** Inclusive lower bound (YYYY-MM-DD). */
  start: string;
  /** Inclusive upper bound (YYYY-MM-DD). */
  end: string;
}

/**
 * Resolves the calendar parts of a reference instant in a given IANA time zone
 * (A3). Falls back to the runtime's local zone if the zone is not resolvable.
 */
function partsInZone(
  reference: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  let formatted: string;
  try {
    // en-CA yields the ISO `YYYY-MM-DD` ordering.
    formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(reference);
  } catch {
    formatted = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(reference);
  }
  const [year, month, day] = formatted.split('-').map((p) => Number(p));
  return { year, month, day };
}

/** Formats numeric calendar parts as a zero-padded `YYYY-MM-DD` string. */
function formatYmd(year: number, month: number, day: number): string {
  const y = year.toString().padStart(4, '0');
  const m = month.toString().padStart(2, '0');
  const d = day.toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Days in a given month (1-based month), accounting for leap years. */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Computes the current Budget_Period window relative to a reference instant,
 * evaluated in the configured platform time zone (Req 10.1, A3).
 *
 * WEEK-START CHOICE: weeks are ISO-8601 style and start on MONDAY and end on
 * SUNDAY. (Documented, deterministic.)
 *   - weekly  : Monday..Sunday of the week containing the reference day.
 *   - monthly : 1st..last day of the reference calendar month.
 *   - yearly  : Jan 1..Dec 31 of the reference calendar year.
 *
 * `reference` is injectable so the computation is a pure, deterministic
 * function that can be unit/property-tested without relying on wall-clock time.
 *
 * @param period the budget's period
 * @param reference the "now" instant to resolve the window around (defaults to now)
 * @param timeZone the IANA platform time zone (A3)
 */
export function computePeriodWindow(
  period: BudgetPeriod,
  reference: Date,
  timeZone: string,
): PeriodWindow {
  const { year, month, day } = partsInZone(reference, timeZone);

  switch (period) {
    case 'yearly':
      return {
        start: formatYmd(year, 1, 1),
        end: formatYmd(year, 12, 31),
      };

    case 'monthly':
      return {
        start: formatYmd(year, month, 1),
        end: formatYmd(year, month, daysInMonth(year, month)),
      };

    case 'weekly': {
      // Determine the day-of-week for the reference calendar day. Using a UTC
      // date built from the resolved parts keeps the weekday stable regardless
      // of the host zone (the parts already reflect the platform zone).
      const refUtc = new Date(Date.UTC(year, month - 1, day));
      const dow = refUtc.getUTCDay(); // 0=Sunday .. 6=Saturday
      // Offset back to Monday: Sunday(0) -> 6 days back, Monday(1) -> 0, etc.
      const daysFromMonday = (dow + 6) % 7;
      const startUtc = new Date(refUtc);
      startUtc.setUTCDate(refUtc.getUTCDate() - daysFromMonday);
      const endUtc = new Date(startUtc);
      endUtc.setUTCDate(startUtc.getUTCDate() + 6);
      return {
        start: formatYmd(
          startUtc.getUTCFullYear(),
          startUtc.getUTCMonth() + 1,
          startUtc.getUTCDate(),
        ),
        end: formatYmd(
          endUtc.getUTCFullYear(),
          endUtc.getUTCMonth() + 1,
          endUtc.getUTCDate(),
        ),
      };
    }
  }
}

/**
 * Converts a `YYYY-MM-DD` window bound into a date-only `Date` at UTC midnight
 * for use in a Prisma `@db.Date` range filter. Mirrors the expense service's
 * date-only handling (A3).
 */
export function windowBoundToDate(ymd: string): Date {
  const [year, month, day] = ymd.split('-').map((p) => Number(p));
  return new Date(Date.UTC(year, month - 1, day));
}
