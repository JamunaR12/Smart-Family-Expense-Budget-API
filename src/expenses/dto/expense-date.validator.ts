import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Strict `YYYY-MM-DD` calendar-date pattern. Expense dates are date-only
 * values (schema stores `@db.Date`); accepting a full timestamp would blur the
 * day-granularity semantics all period/month windows depend on (A3).
 */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a `YYYY-MM-DD` string into its calendar parts and verifies it is a
 * real calendar date (rejects `2024-02-30`, `2024-13-01`, etc.). Returns the
 * parsed parts, or `null` when the value is not a valid calendar date.
 */
export function parseCalendarDate(
  value: string,
): { year: number; month: number; day: number } | null {
  if (!DATE_ONLY_PATTERN.test(value)) {
    return null;
  }
  const [year, month, day] = value.split('-').map((p) => Number(p));
  // Construct as UTC to avoid host-timezone shifting the day, then confirm the
  // round-trip matches (this rejects overflowed values like 2024-02-30).
  const asDate = new Date(Date.UTC(year, month - 1, day));
  if (
    asDate.getUTCFullYear() !== year ||
    asDate.getUTCMonth() !== month - 1 ||
    asDate.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * Returns today's date (date-only) as `YYYY-MM-DD` evaluated in the given IANA
 * time zone (the configured `PLATFORM_TIMEZONE`, A3). Falls back to the raw
 * value if the zone is not resolvable by the runtime.
 */
export function todayInZone(timeZone: string): string {
  try {
    // en-CA yields the ISO `YYYY-MM-DD` ordering.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
}

/**
 * Validates that a value is a valid `YYYY-MM-DD` calendar date (Req 4.5, 5.10).
 *
 * This decorator only enforces the calendar-date SYNTAX/validity; the
 * "not in the future" rule (Req 4.5) is applied in the service where the
 * configured `PLATFORM_TIMEZONE` is available, so "today" is evaluated in the
 * single platform zone rather than the server's local zone.
 */
export function IsCalendarDate(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'isCalendarDate',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && parseCalendarDate(value) !== null;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a valid calendar date in YYYY-MM-DD format`;
        },
      },
    });
  };
}
