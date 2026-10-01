import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import type { BudgetPeriod } from '@prisma/client';
import {
  IsMoneyAmount,
  MONEY_MAX,
  MONEY_MIN,
} from '../../expenses/dto/money.validator';

/** The valid Budget_Period values (Req 9.1, 9.4), matching the Prisma enum. */
export const BUDGET_PERIODS: BudgetPeriod[] = ['weekly', 'monthly', 'yearly'];

/**
 * Budget creation request contract (Req 9.1-9.5).
 *
 * `limitAmount` reuses the shared money validator (0.01-999,999,999.99, at most
 * two decimals — Req 9.1, 9.3). `period` must be one of the enum values
 * (Req 9.4). `categoryId` is optional; when present it must be a UUID and is
 * verified to be owned by the user in the service (Req 9.2, 9.5). The global
 * `ValidationPipe` (forbidNonWhitelisted) rejects unknown fields and no record
 * is persisted on failure.
 */
export class CreateBudgetDto {
  @ApiProperty({
    description:
      'Spending limit as a decimal string with at most two decimal places, ' +
      `in the range ${MONEY_MIN}-${MONEY_MAX}.`,
    example: '500.00',
    type: String,
  })
  @IsNotEmpty({ message: 'limitAmount is required' })
  @IsMoneyAmount()
  limitAmount!: string;

  @ApiProperty({
    description: 'Budget period.',
    enum: BUDGET_PERIODS,
    example: 'monthly',
  })
  @IsNotEmpty({ message: 'period is required' })
  @IsIn(BUDGET_PERIODS, {
    message: `period must be one of: ${BUDGET_PERIODS.join(', ')}`,
  })
  period!: BudgetPeriod;

  @ApiProperty({
    description:
      'Optional category identifier owned by the user; when present the ' +
      'budget is scoped to that category.',
    format: 'uuid',
    required: false,
    example: '7c3e0b1a-9d5f-4c2e-8a6b-1f2d3e4a5b6c',
  })
  @IsOptional()
  @IsUUID('4', { message: 'categoryId must be a valid UUID' })
  categoryId?: string;
}
