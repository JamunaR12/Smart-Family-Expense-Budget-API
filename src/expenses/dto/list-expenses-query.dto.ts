import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { IsCalendarDate } from './expense-date.validator';

/** Default page size when `limit` is omitted (Req 5.5). */
export const DEFAULT_LIMIT = 20;
/** Maximum permitted page size (Req 5.5). */
export const MAX_LIMIT = 100;
/** Minimum permitted page size (Req 5.5). */
export const MIN_LIMIT = 1;
/** Default offset when omitted (Req 5.5). */
export const DEFAULT_OFFSET = 0;

/**
 * Expense list query contract (Req 5.2-5.5, 5.10).
 *
 * All parameters are optional. When present each is validated with the same
 * rigor as a body field: malformed or out-of-range pagination/date/category
 * parameters are rejected by the global `ValidationPipe`, naming the offending
 * parameter and returning no expenses (Req 5.10). Query strings are coerced to
 * their target types via `transform` + `@Type`.
 *
 * Cross-field validity (`startDate <= endDate`) is enforced in the service so a
 * single, clear invalid-range error can be raised (Req 5.10).
 */
export class ListExpensesQueryDto {
  /**
   * Inclusive lower date bound (`YYYY-MM-DD`) — expenses on/after this date
   * are included (Req 5.3).
   */
  @ApiPropertyOptional({
    description: 'Inclusive start date (YYYY-MM-DD).',
    example: '2024-01-01',
  })
  @IsOptional()
  @IsCalendarDate()
  startDate?: string;

  /**
   * Inclusive upper date bound (`YYYY-MM-DD`) — expenses on/before this date
   * are included (Req 5.3).
   */
  @ApiPropertyOptional({
    description: 'Inclusive end date (YYYY-MM-DD).',
    example: '2024-01-31',
  })
  @IsOptional()
  @IsCalendarDate()
  endDate?: string;

  /** Owner-scoped category filter (Req 5.4). */
  @ApiPropertyOptional({
    description: 'Filter to a single category owned by the user.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4', { message: 'categoryId must be a valid UUID' })
  categoryId?: string;

  /** Page size, 1-100, default 20 (Req 5.5). */
  @ApiPropertyOptional({
    description: `Page size (${MIN_LIMIT}-${MAX_LIMIT}), default ${DEFAULT_LIMIT}.`,
    minimum: MIN_LIMIT,
    maximum: MAX_LIMIT,
    default: DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(MIN_LIMIT, { message: `limit must be at least ${MIN_LIMIT}` })
  @Max(MAX_LIMIT, { message: `limit must be at most ${MAX_LIMIT}` })
  limit: number = DEFAULT_LIMIT;

  /** Result offset, >= 0, default 0 (Req 5.5). */
  @ApiPropertyOptional({
    description: `Result offset (>= ${DEFAULT_OFFSET}), default ${DEFAULT_OFFSET}.`,
    minimum: 0,
    default: DEFAULT_OFFSET,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'offset must be an integer' })
  @Min(0, { message: 'offset must be 0 or greater' })
  offset: number = DEFAULT_OFFSET;
}
