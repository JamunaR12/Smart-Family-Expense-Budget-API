import { ApiProperty } from '@nestjs/swagger';
import type { Expense } from '@prisma/client';

/**
 * API representation of an Expense (Req 4.1, 5.1).
 *
 * This is the ONLY shape returned to clients. It is built via {@link toExpenseResponse}
 * from a Prisma `Expense` row that has ALREADY been owner-scoped, so no field
 * ever carries another user's data (the row's `userId` is intentionally NOT
 * surfaced — it is an internal isolation key, Req 3.3).
 *
 * `amount` is serialized as a STRING (e.g. "42.50") to preserve the exact
 * two-decimal precision of the Decimal(12,2) column without floating-point
 * drift in JSON (design ADR-5). `date` is a date-only `YYYY-MM-DD` string to
 * match the day-granularity semantics of the stored `@db.Date` column (A3).
 */
export class ExpenseResponse {
  @ApiProperty({
    description: 'Unique expense identifier (UUID).',
    format: 'uuid',
    example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  })
  id!: string;

  @ApiProperty({
    description: 'Identifier of the owning category.',
    format: 'uuid',
    example: '7c3e0b1a-9d5f-4c2e-8a6b-1f2d3e4a5b6c',
  })
  categoryId!: string;

  @ApiProperty({
    description: 'Monetary amount as a decimal string (two decimal places).',
    example: '42.50',
  })
  amount!: string;

  @ApiProperty({
    description: 'ISO 4217 3-letter currency code (uppercase).',
    example: 'USD',
  })
  currency!: string;

  @ApiProperty({
    description: 'Expense date (YYYY-MM-DD).',
    example: '2024-01-15',
  })
  date!: string;

  @ApiProperty({
    description: 'Optional description (null when not set).',
    nullable: true,
    example: 'Weekly grocery run',
  })
  description!: string | null;

  @ApiProperty({
    description: 'When the expense was created (ISO 8601).',
    format: 'date-time',
    example: '2024-01-15T09:24:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'When the expense was last updated (ISO 8601).',
    format: 'date-time',
    example: '2024-01-15T09:24:00.000Z',
  })
  updatedAt!: Date;
}

/** Pagination metadata echoed on list responses (design §API Design / meta). */
export class PaginationMeta {
  @ApiProperty({ description: 'Requested page size.', example: 20 })
  limit!: number;

  @ApiProperty({ description: 'Requested offset.', example: 0 })
  offset!: number;

  @ApiProperty({
    description:
      'Total number of expenses matching the filters (owner-scoped).',
    example: 57,
  })
  total!: number;
}

/** A paginated list of expenses (Req 5.2, 5.5, 5.6). */
export class ExpenseListResponse {
  @ApiProperty({ type: [ExpenseResponse] })
  data!: ExpenseResponse[];

  @ApiProperty({ type: PaginationMeta })
  meta!: { pagination: PaginationMeta };
}

/** Confirmation returned on successful deletion (Req 7.1). */
export class DeleteExpenseResponse {
  @ApiProperty({
    description: 'Always true on a successful delete.',
    example: true,
  })
  deleted!: boolean;

  @ApiProperty({
    description: 'Identifier of the deleted expense.',
    format: 'uuid',
    example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  })
  id!: string;
}

/**
 * Formats a stored `@db.Date` value as a `YYYY-MM-DD` string using its UTC
 * calendar parts. The column stores a date-only value, so reading its UTC
 * parts yields the intended calendar day regardless of host time zone (A3).
 */
function formatDateOnly(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Maps a Prisma `Expense` row to the public {@link ExpenseResponse}.
 *
 * The caller MUST pass a row already restricted to the authenticated owner
 * (owner-scoped query). `userId` is deliberately dropped from the output; the
 * Decimal `amount` is stringified (`toFixed(2)`) to guarantee two decimals.
 */
export function toExpenseResponse(expense: Expense): ExpenseResponse {
  return {
    id: expense.id,
    categoryId: expense.categoryId,
    // Prisma.Decimal -> exact two-decimal string (design ADR-5).
    amount: expense.amount.toFixed(2),
    currency: expense.currency,
    date: formatDateOnly(expense.date),
    description: expense.description ?? null,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
  };
}
