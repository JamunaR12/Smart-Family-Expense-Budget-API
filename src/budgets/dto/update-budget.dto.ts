import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import type { BudgetPeriod } from '@prisma/client';
import {
  IsMoneyAmount,
  MONEY_MAX,
  MONEY_MIN,
} from '../../expenses/dto/money.validator';
import { BUDGET_PERIODS } from './create-budget.dto';

/**
 * Budget update request contract (Req 9.7).
 *
 * Every field is optional (a partial update), but any field that IS present is
 * validated with the SAME rules as create — limit range/precision (Req 9.3),
 * period enum (Req 9.4), and category ownership (verified in the service,
 * Req 9.5). Validation failure leaves the stored budget unchanged.
 */
export class UpdateBudgetDto {
  @ApiProperty({
    description:
      'New spending limit as a decimal string with at most two decimal ' +
      `places, in the range ${MONEY_MIN}-${MONEY_MAX}.`,
    required: false,
    example: '750.00',
    type: String,
  })
  @IsOptional()
  @IsMoneyAmount()
  limitAmount?: string;

  @ApiProperty({
    description: 'New budget period.',
    enum: BUDGET_PERIODS,
    required: false,
    example: 'weekly',
  })
  @IsOptional()
  @IsIn(BUDGET_PERIODS, {
    message: `period must be one of: ${BUDGET_PERIODS.join(', ')}`,
  })
  period?: BudgetPeriod;

  @ApiProperty({
    description:
      'New category scope owned by the user; when present the budget is ' +
      'scoped to that category.',
    format: 'uuid',
    required: false,
    example: '7c3e0b1a-9d5f-4c2e-8a6b-1f2d3e4a5b6c',
  })
  @IsOptional()
  @IsUUID('4', { message: 'categoryId must be a valid UUID' })
  categoryId?: string;
}
