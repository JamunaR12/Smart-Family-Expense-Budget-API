import { ApiProperty } from '@nestjs/swagger';
import {
  IsISO4217CurrencyCode,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { IsMoneyAmount, MONEY_MAX, MONEY_MIN } from './money.validator';
import { IsCalendarDate } from './expense-date.validator';

/**
 * Expense update request contract (Req 6.1-6.4).
 *
 * Every field is optional (a partial update), but any field that IS present is
 * validated with the SAME rules as create — amount range/precision (Req 6.2),
 * description length (Req 6.3), currency, date, and category ownership
 * (verified in the service, Req 6.4). The global `ValidationPipe`
 * (forbidNonWhitelisted) rejects unknown fields, and validation failure leaves
 * the stored expense unchanged (Req 6.2, 6.3, 6.4).
 */
export class UpdateExpenseDto {
  /** New amount (same rules as create) — see {@link IsMoneyAmount} (Req 6.2). */
  @ApiProperty({
    description:
      'New monetary amount as a decimal string with at most two decimal ' +
      `places, in the range ${MONEY_MIN}-${MONEY_MAX}.`,
    required: false,
    example: '55.00',
    type: String,
  })
  @IsOptional()
  @IsMoneyAmount()
  amount?: string;

  /** New ISO 4217 currency code (Req 6.1). Stored uppercase by the service. */
  @ApiProperty({
    description: 'New ISO 4217 3-letter currency code.',
    required: false,
    example: 'EUR',
  })
  @IsOptional()
  @IsString({ message: 'currency must be a string' })
  @IsISO4217CurrencyCode({
    message: 'currency must be a valid ISO 4217 currency code',
  })
  currency?: string;

  /** New expense date (`YYYY-MM-DD`, valid, non-future — Req 6.1). */
  @ApiProperty({
    description: 'New expense date (YYYY-MM-DD). Must be valid and non-future.',
    required: false,
    example: '2024-02-01',
    type: String,
  })
  @IsOptional()
  @IsCalendarDate()
  date?: string;

  /** New owning category (existence/ownership verified in the service, Req 6.4). */
  @ApiProperty({
    description: 'New category identifier owned by the authenticated user.',
    format: 'uuid',
    required: false,
    example: '7c3e0b1a-9d5f-4c2e-8a6b-1f2d3e4a5b6c',
  })
  @IsOptional()
  @IsUUID('4', { message: 'categoryId must be a valid UUID' })
  categoryId?: string;

  /** New description, at most 500 characters (Req 6.3). */
  @ApiProperty({
    description: 'New description, at most 500 characters.',
    required: false,
    maxLength: 500,
    example: 'Corrected description',
  })
  @IsOptional()
  @IsString({ message: 'description must be a string' })
  @MaxLength(500, {
    message: 'description must be at most 500 characters',
  })
  description?: string;
}
