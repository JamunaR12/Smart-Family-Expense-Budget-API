import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { parseMonth } from '../month-window';

/**
 * Validates that a value is a strict `YYYY-MM` month whose month part is 01-12
 * (Req 11.1, 11.6).
 *
 * This mirrors the `IsCalendarDate` decorator used for expense dates: it only
 * enforces the SYNTAX/validity of the month token. A malformed or out-of-range
 * month is rejected by the global `ValidationPipe` before any insight is
 * computed, naming the `month` field (Req 11.6, Property 5).
 */
export function IsMonth(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'isMonth',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && parseMonth(value) !== null;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a valid month in YYYY-MM format (month 01-12)`;
        },
      },
    });
  };
}
