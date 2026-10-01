/**
 * A date-only, inclusive `[start, end]` window expressed as `YYYY-MM-DD`
 * strings. Both bounds are calendar days; because the stored expense `date` is
 * a date-only value (schema `@db.Date`), evaluating the window at day
 * granularity avoids any timezone-shift ambiguity, and the `YYYY-MM-DD` strings
 * compare lexicographically in chronological order (A3).
 *
 * This mirrors the shape used by the budgets' `PeriodWindow` (budget-period.ts)
 * so the analytics aggregation reuses the exact same date-range filter pattern.
 */
export interface MonthWindow {
  /** Inclusive lower bound (first day of the month, YYYY-MM-DD). */
  start: string;
  /** Inclusive upper bound (last day of the month, YYYY-MM-DD). */
  end: string;
}

/** Strict `YYYY-MM` month pattern (four-digit year, two-digit month). */
export const MONTH_PATTERN = /^\d{4}-\d{2}$/;

/** Days in a given month (1-based month), accounting for leap years. */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Parses a strict `YYYY-MM` month string, verifying the month is 01-12.
 * Returns the numeric parts, or `null` when the value is not a valid month.
 *
 * Used both by the DTO validator (to reject a malformed/missing month with a
 * field-level VALIDATION_ERROR, Req 11.6) and by {@link monthWindow}.
 */
export function parseMonth(
  value: string,
): { year: number; month: number } | null {
  if (typeof value !== 'string' || !MONTH_PATTERN.test(value)) {
    return null;
  }
  const [year, month] = value.split('-').map((p) => Number(p));
  if (month < 1 || month > 12) {
    return null;
  }
  return { year, month };
}

/**
 * Computes the inclusive calendar-day window for a `YYYY-MM` month (Req 11.1).
 *
 * The window is `[first day .. last day]` of the given calendar month, leap-year
 * aware (e.g. `2024-02` -> `2024-02-01 .. 2024-02-29`; `2023-02` ->
 * `... .. 2023-02-28`). The month is explicit in the request, so no "current
 * time"/timezone resolution is needed — the function is a pure, deterministic
 * mapping suitable for property testing (Property 1).
 *
 * @param month a validated `YYYY-MM` string
 * @throws Error when `month` is not a valid `YYYY-MM` value (callers should
 *   validate via the DTO first; this guard makes misuse explicit).
 */
export function monthWindow(month: string): MonthWindow {
  const parts = parseMonth(month);
  if (!parts) {
    throw new Error(`invalid month: ${month}`);
  }
  const { year, month: m } = parts;
  const last = daysInMonth(year, m);
  const y = year.toString().padStart(4, '0');
  const mm = m.toString().padStart(2, '0');
  const dd = last.toString().padStart(2, '0');
  return {
    start: `${y}-${mm}-01`,
    end: `${y}-${mm}-${dd}`,
  };
}
