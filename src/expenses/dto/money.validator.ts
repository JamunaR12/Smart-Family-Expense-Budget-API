import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Effective monetary bounds for expense amounts.
 *
 * Requirements state the create amount is `> 0.00` (Req 4.1) while update /
 * budget / analytics use `0.01` (Req 6.1, 9.1, 11.5). The design resolves this
 * discrepancy (§Ambiguities item 11) by treating `0.01` as the effective
 * minimum everywhere for two-decimal money. `12,2` Decimal covers the max.
 */
export const MONEY_MIN = 0.01;
export const MONEY_MAX = 999_999_999.99;

/**
 * Matches a monetary string with an optional sign check handled separately:
 * one or more digits, optionally followed by a `.` and 1-2 decimal digits.
 * Rejecting >2 decimal places is a hard requirement (Req 4.2, 6.2).
 */
const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Validates that a value is a monetary amount in the range
 * [0.01, 999,999,999.99] with AT MOST two decimal places (Req 4.1/4.2,
 * 6.1/6.2). Accepts either a `number` or a numeric `string`; a string is the
 * preferred wire format because it preserves two-decimal precision without
 * floating-point drift (design ADR-5).
 *
 * Rejects: zero, negative, non-numeric, over-max, and more-than-two-decimals.
 */
export function IsMoneyAmount(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'isMoneyAmount',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          // Normalize to a trimmed string for a single precision-safe check.
          let text: string;
          if (typeof value === 'number') {
            if (!Number.isFinite(value)) {
              return false;
            }
            // Reject a number carrying >2 decimals (e.g. 1.005) — the string
            // form of the number is checked against the 2dp pattern.
            text = value.toString();
          } else if (typeof value === 'string') {
            text = value.trim();
          } else {
            return false;
          }

          if (!MONEY_PATTERN.test(text)) {
            return false;
          }

          const numeric = Number(text);
          if (!Number.isFinite(numeric)) {
            return false;
          }
          return numeric >= MONEY_MIN && numeric <= MONEY_MAX;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a monetary amount between ${MONEY_MIN} and ${MONEY_MAX} with at most two decimal places`;
        },
      },
    });
  };
}
