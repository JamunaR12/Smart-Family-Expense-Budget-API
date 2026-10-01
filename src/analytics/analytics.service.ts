import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ownerScope } from '../common/owner-scope';
import { windowBoundToDate } from '../budgets/budget-period';
import { monthWindow } from './month-window';
import {
  CategoryInsightResponse,
  MonthlyInsightResponse,
} from './dto/insight-response';

/** Machine-readable code for a field-level validation failure (Req 13.4). */
export const VALIDATION_ERROR_CODE = 'VALIDATION_ERROR';

/**
 * Spending analytics business logic (Req 11).
 *
 * Data_Isolation is enforced by owner-scoping EVERY aggregation with
 * `ownerScope(userId)` (Req 3.3, 11.3): totals are computed ONLY from the
 * requesting user's expenses. Deleted expenses are naturally excluded because
 * they are no longer rows in the table — no special handling is required, which
 * satisfies Req 7.4 / Property 3.
 *
 * All summation is performed by the database SUM, which returns a
 * `Prisma.Decimal`; a null sum (no matching rows) maps to `Decimal(0)` and the
 * response serializes with `toFixed(2)`, preserving the arithmetic-sum
 * invariant to within 0.01 (Req 11.5, Properties 1, 2). Empty matches therefore
 * return zero totals rather than an error (Req 11.4, Property 4).
 *
 * MIXED CURRENCY (A2): amounts are summed numerically regardless of currency;
 * no currency conversion is done (design §Ambiguities item 3).
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Computes the monthly spending insight (Req 11.1, 11.4, 11.5).
   *
   * Builds the inclusive `[first day .. last day]` window for the requested
   * `YYYY-MM` month (leap-aware, pure) and sums the owner's expenses whose
   * date falls within it. The window bounds are converted to UTC-midnight
   * `Date`s for the `@db.Date` range filter, mirroring the budgets service.
   */
  async monthlyTotal(
    userId: string,
    month: string,
  ): Promise<MonthlyInsightResponse> {
    const window = monthWindow(month);

    const aggregate = await this.prisma.expense.aggregate({
      _sum: { amount: true },
      where: {
        ...ownerScope(userId),
        date: {
          gte: windowBoundToDate(window.start),
          lte: windowBoundToDate(window.end),
        },
      },
    });

    const total = aggregate._sum.amount ?? new Prisma.Decimal(0);
    return { month, total: total.toFixed(2) };
  }

  /**
   * Computes the by-category spending insight for an inclusive range (Req 11.2,
   * 11.4, 11.5, 11.6).
   *
   * Cross-field validation first: `startDate` must be on or before `endDate`,
   * otherwise a VALIDATION_ERROR is raised and NO insight is computed (Req 11.6,
   * Property 5). Groups the owner's in-range expenses by `categoryId` with a
   * Decimal SUM per group; only categories that have at least one in-range
   * expense appear (empty array when none, Req 11.4). Results are ordered by
   * `categoryId` for a deterministic response.
   */
  async byCategory(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<CategoryInsightResponse> {
    if (startDate > endDate) {
      throw new BadRequestException({
        code: VALIDATION_ERROR_CODE,
        message: 'startDate must be on or before endDate',
        details: [{ field: 'startDate', reason: 'range start after end' }],
      });
    }

    const groups = await this.prisma.expense.groupBy({
      by: ['categoryId'],
      _sum: { amount: true },
      where: {
        ...ownerScope(userId),
        date: {
          gte: windowBoundToDate(startDate),
          lte: windowBoundToDate(endDate),
        },
      },
      orderBy: [{ categoryId: 'asc' }],
    });

    const categories = groups.map((group) => ({
      categoryId: group.categoryId,
      total: (group._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
    }));

    return { startDate, endDate, categories };
  }
}
