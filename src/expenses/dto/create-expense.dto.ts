import { ApiProperty } from '@nestjs/swagger';
import {
  IsISO4217CurrencyCode,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { IsMoneyAmount, MONEY_MAX, MONEY_MIN } from './money.validator';
import { IsCalendarDate } from './expense-date.validator';

/**
 * Expense creation request contract (Req 4.1-4.6).
 *
 * Every field is validated by the global `ValidationPipe`
 * (whitelist + forbidNonWhitelisted) BEFORE the request reaches the service, so
 * unknown fields are rejected and no record is persisted on failure
 * (Req 4.2, 4.3, 4.4). Category existence/ownership is verified in the service
 * (Req 4.3) since it requires a DB lookup scoped to the authenticated user.
 */
export class CreateExpenseDto {
  /**
   * Monetary amount in [0.01, 999,999,999.99] with at most two decimal places
   * (Req 4.1, 4.2). Accepted as a string to preserve two-decimal precision.
   */
  @ApiProperty({
    description:
      'Monetary amount as a decimal string with at most two decimal places, ' +
      `in the range ${MONEY_MIN}-${MONEY_MAX}.`,
    example: '42.50',
    type: String,
  })
  @IsNotEmpty({ message: 'amount is required' })
  @IsMoneyAmount()
  amount!: string;

  /**
   * ISO 4217 3-letter currency code (Req 4.5). Stored uppercase by the service.
   */
  @ApiProperty({
    description: 'ISO 4217 3-letter currency code (e.g. USD, EUR).',
    example: 'USD',
  })
  @IsNotEmpty({ message: 'currency is required' })
  @IsString({ message: 'currency must be a string' })
  @IsISO4217CurrencyCode({
    message: 'currency must be a valid ISO 4217 currency code',
  })
  currency!: string;

  /**
   * Expense date as `YYYY-MM-DD` — a valid calendar date not in the future
   * (Req 4.5). The "not future" check is applied in the service against the
   * configured platform time zone.
   */
  @ApiProperty({
    description: 'Expense date (YYYY-MM-DD). Must be a valid, non-future date.',
    example: '2024-01-15',
    type: String,
  })
  @IsNotEmpty({ message: 'date is required' })
  @IsCalendarDate()
  date!: string;

  /**
   * Owning category reference (Req 4.3). Existence and ownership are verified
   * in the service against the authenticated user.
   */
  @ApiProperty({
    description: 'Identifier of a category owned by the authenticated user.',
    format: 'uuid',
    example: '7c3e0b1a-9d5f-4c2e-8a6b-1f2d3e4a5b6c',
  })
  @IsNotEmpty({ message: 'categoryId is required' })
  @IsUUID('4', { message: 'categoryId must be a valid UUID' })
  categoryId!: string;

  /** Optional free-text description, at most 500 characters (Req 4.6). */
  @ApiProperty({
    description: 'Optional description, at most 500 characters.',
    required: false,
    maxLength: 500,
    example: 'Weekly grocery run',
  })
  @IsOptional()
  @IsString({ message: 'description must be a string' })
  @MaxLength(500, {
    message: 'description must be at most 500 characters',
  })
  description?: string;
}
