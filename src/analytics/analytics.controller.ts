import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import { MonthlyInsightQueryDto } from './dto/monthly-insight-query.dto';
import { CategoryInsightQueryDto } from './dto/category-insight-query.dto';
import {
  CategoryInsightResponse,
  MonthlyInsightResponse,
} from './dto/insight-response';
import { ErrorResponse } from '../auth/dto/auth-responses';

/**
 * Spending analytics HTTP boundary (Req 11).
 *
 * Served under `/api/v1/analytics`. Every route is protected by the global
 * `JwtAuthGuard` (NOT `@Public()`), so an unauthenticated request is rejected
 * with 401 before reaching the handler. Each service call is scoped to
 * `currentUser.id` for Data_Isolation (Req 3.3, 11.3). The controller only
 * binds and delegates; all business rules live in `AnalyticsService`.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller({ path: 'analytics', version: '1' })
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** Monthly spending insight (Req 11.1). */
  @Get('monthly')
  @ApiOperation({
    summary: 'Monthly spending insight',
    description:
      "Returns the arithmetic sum of the authenticated user's expenses dated " +
      'within the specified month (YYYY-MM). Amounts are summed numerically ' +
      'regardless of currency (no conversion, A2). Returns 0.00 when nothing ' +
      'matches.',
  })
  @ApiQuery({
    name: 'month',
    required: true,
    type: String,
    example: '2024-01',
    description: 'Target month (YYYY-MM, month 01-12).',
  })
  @ApiResponse({ status: HttpStatus.OK, type: MonthlyInsightResponse })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'VALIDATION_ERROR — the month is missing or malformed.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'AUTH_REQUIRED / AUTH_FAILED — missing or invalid token.',
    type: ErrorResponse,
  })
  monthly(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MonthlyInsightQueryDto,
  ): Promise<MonthlyInsightResponse> {
    return this.analytics.monthlyTotal(user.id, query.month);
  }

  /** By-category spending insight over an inclusive date range (Req 11.2). */
  @Get('by-category')
  @ApiOperation({
    summary: 'By-category spending insight',
    description:
      "Returns the authenticated user's expenses grouped by category with a " +
      'per-category arithmetic total within the inclusive [startDate, endDate] ' +
      'range. Amounts are summed numerically regardless of currency (no ' +
      'conversion, A2). Returns an empty list when nothing matches.',
  })
  @ApiQuery({
    name: 'startDate',
    required: true,
    type: String,
    example: '2024-01-01',
    description: 'Inclusive range start (YYYY-MM-DD).',
  })
  @ApiQuery({
    name: 'endDate',
    required: true,
    type: String,
    example: '2024-01-31',
    description: 'Inclusive range end (YYYY-MM-DD).',
  })
  @ApiResponse({ status: HttpStatus.OK, type: CategoryInsightResponse })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'VALIDATION_ERROR — a date bound is missing/malformed, or startDate is ' +
      'after endDate.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'AUTH_REQUIRED / AUTH_FAILED — missing or invalid token.',
    type: ErrorResponse,
  })
  byCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CategoryInsightQueryDto,
  ): Promise<CategoryInsightResponse> {
    return this.analytics.byCategory(user.id, query.startDate, query.endDate);
  }
}
