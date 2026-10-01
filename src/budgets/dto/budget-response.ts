import { ApiProperty } from '@nestjs/swagger';
import type { Budget, BudgetPeriod } from '@prisma/client';

/**
 * API representation of a Budget (Req 9.1, 9.6).
 *
 * Built via {@link toBudgetResponse} from a Prisma `Budget` row that has ALREADY
 * been owner-scoped, so no field carries another user's data; the internal
 * `userId` isolation key is deliberately NOT surfaced (Req 3.3).
 *
 * `limitAmount` is serialized as a STRING (e.g. "500.00") to preserve the exact
 * two-decimal precision of the Decimal(12,2) column without floating-point
 * drift in JSON (design ADR-5).
 */
export class BudgetResponse {
  @ApiProperty({
    description: 'Unique budget identifier (UUID).',
    format: 'uuid',
    example: 'b1d2c3e4-5f6a-4b7c-8d9e-0a1b2c3d4e5f',
  })
  id!: string;

  @ApiProperty({
    description: 'Spending limit as a decimal string (two decimal places).',
    example: '500.00',
  })
  limitAmount!: string;

  @ApiProperty({
    description: 'Budget period.',
    enum: ['weekly', 'monthly', 'yearly'],
    example: 'monthly',
  })
  period!: BudgetPeriod;

  @ApiProperty({
    description:
      'Identifier of the scoped category, or null for an unscoped ' +
      '(all-categories) budget.',
    format: 'uuid',
    nullable: true,
    example: '7c3e0b1a-9d5f-4c2e-8a6b-1f2d3e4a5b6c',
  })
  categoryId!: string | null;

  @ApiProperty({
    description: 'When the budget was created (ISO 8601).',
    format: 'date-time',
    example: '2024-01-15T09:24:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'When the budget was last updated (ISO 8601).',
    format: 'date-time',
    example: '2024-01-15T09:24:00.000Z',
  })
  updatedAt!: Date;
}

/** Confirmation returned on successful deletion (Req 9.8). */
export class DeleteBudgetResponse {
  @ApiProperty({
    description: 'Always true on a successful delete.',
    example: true,
  })
  deleted!: boolean;

  @ApiProperty({
    description: 'Identifier of the deleted budget.',
    format: 'uuid',
    example: 'b1d2c3e4-5f6a-4b7c-8d9e-0a1b2c3d4e5f',
  })
  id!: string;
}

/** Budget status/tracking outcome (Req 10.1-10.5). */
export type BudgetStatusValue = 'within_limit' | 'exceeded';

/**
 * Budget status response (Req 10.1-10.3, 10.5).
 *
 * All monetary fields are two-decimal STRINGS (design ADR-5). `exceeded` is
 * present ONLY when the status is `exceeded` (Req 10.3); otherwise it is
 * omitted. `remaining` is `limit - total` and is >= 0 when within-limit
 * (Req 10.2).
 */
export class BudgetStatusResponse {
  @ApiProperty({
    description: 'Identifier of the budget whose status was computed.',
    format: 'uuid',
    example: 'b1d2c3e4-5f6a-4b7c-8d9e-0a1b2c3d4e5f',
  })
  budgetId!: string;

  @ApiProperty({
    description: 'The budget period the window was computed for.',
    enum: ['weekly', 'monthly', 'yearly'],
    example: 'monthly',
  })
  period!: BudgetPeriod;

  @ApiProperty({
    description: 'The budget limit as a decimal string (two decimals).',
    example: '500.00',
  })
  limit!: string;

  @ApiProperty({
    description:
      'Total in-scope, in-period spend as a decimal string (two decimals).',
    example: '320.00',
  })
  total!: string;

  @ApiProperty({
    description:
      'Remaining amount (limit - total) as a decimal string (two decimals). ' +
      '>= 0 when within-limit.',
    example: '180.00',
  })
  remaining!: string;

  @ApiProperty({
    description: 'Whether spending is within the limit or has exceeded it.',
    enum: ['within_limit', 'exceeded'],
    example: 'within_limit',
  })
  status!: BudgetStatusValue;

  @ApiProperty({
    description:
      'Amount over the limit (total - limit) as a decimal string; present ' +
      'only when the status is exceeded.',
    required: false,
    example: '25.00',
  })
  exceeded?: string;
}

/**
 * Maps a Prisma `Budget` row to the public {@link BudgetResponse}.
 *
 * The caller MUST pass a row already restricted to the authenticated owner
 * (owner-scoped query). `userId` is deliberately dropped; the Decimal
 * `limitAmount` is stringified (`toFixed(2)`) to guarantee two decimals.
 */
export function toBudgetResponse(budget: Budget): BudgetResponse {
  return {
    id: budget.id,
    limitAmount: budget.limitAmount.toFixed(2),
    period: budget.period,
    categoryId: budget.categoryId ?? null,
    createdAt: budget.createdAt,
    updatedAt: budget.updatedAt,
  };
}
