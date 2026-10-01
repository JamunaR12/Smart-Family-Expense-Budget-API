import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Budget } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { ownerScope } from '../common/owner-scope';
import { assertOwnership } from '../common/guards/ownership.guard';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import {
  BudgetResponse,
  BudgetStatusResponse,
  toBudgetResponse,
} from './dto/budget-response';
import { computePeriodWindow, windowBoundToDate } from './budget-period';

/** Machine-readable code for a field-level validation failure (Req 13.4). */
export const VALIDATION_ERROR_CODE = 'VALIDATION_ERROR';

/**
 * Budget business logic (Req 9, 10).
 *
 * Data_Isolation is enforced by owner-scoping EVERY query with
 * `ownerScope(userId)` (Req 3.3): single-resource reads/updates/deletes add
 * `userId` to the `where` clause so a budget owned by someone else — or one
 * that does not exist — collapses to the SAME non-disclosing not-found response
 * (Req 9.9, 10.4, 3.2). List queries only ever return the owner's rows and
 * yield an empty list when none exist (Req 9.6).
 *
 * Money is handled as `Prisma.Decimal` in and out; responses serialize it to a
 * two-decimal string (design ADR-5). Status arithmetic (total/remaining/
 * exceeded) uses `Prisma.Decimal` — never JS floats — to preserve the sum
 * invariant to within 0.01 (Req 10, feeds Property 25).
 */
@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Verifies the referenced category exists AND is owned by the user (Req 9.5).
   * A missing/foreign category is a VALIDATION error indicating the category is
   * not accessible, NOT a not-found, and no budget is created/modified.
   */
  private async assertCategoryOwned(
    userId: string,
    categoryId: string,
  ): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, ...ownerScope(userId) },
      select: { id: true },
    });
    if (!category) {
      throw new BadRequestException({
        code: VALIDATION_ERROR_CODE,
        message: 'categoryId is not accessible to the user',
        details: [
          { field: 'categoryId', reason: 'category is not accessible' },
        ],
      });
    }
  }

  /**
   * Creates a budget owned by the user (Req 9.1-9.5).
   *
   * Limit range/precision and period-enum validity are enforced by the DTO;
   * category ownership is verified BEFORE any write (Req 9.5), so a rejected
   * request never persists a record.
   */
  async create(userId: string, dto: CreateBudgetDto): Promise<BudgetResponse> {
    if (dto.categoryId !== undefined) {
      await this.assertCategoryOwned(userId, dto.categoryId);
    }

    const created = await this.prisma.budget.create({
      data: {
        userId,
        categoryId: dto.categoryId ?? null,
        limitAmount: new Prisma.Decimal(dto.limitAmount),
        period: dto.period,
      },
    });

    return toBudgetResponse(created);
  }

  /** Returns the user's budgets owner-scoped; empty when none (Req 9.6). */
  async findMany(userId: string): Promise<BudgetResponse[]> {
    const rows = await this.prisma.budget.findMany({
      where: { ...ownerScope(userId) },
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows.map(toBudgetResponse);
  }

  /** Returns a single owned budget (Req 9.9 / 10.4 semantics). */
  async findOne(userId: string, id: string): Promise<BudgetResponse> {
    const budget = await this.loadOwned(userId, id);
    return toBudgetResponse(budget);
  }

  /**
   * Updates an owned budget (Req 9.7, 9.9).
   *
   * Loads owner-scoped first: a missing id or a non-owned budget both yield the
   * non-disclosing not-found (consistent with the design's `/:id` approach,
   * Req 9.9). Any invalid field (limit/period/category) is rejected BEFORE the
   * write, leaving the stored budget unchanged (Req 9.3, 9.4, 9.5). Only
   * provided fields are applied (partial update).
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateBudgetDto,
  ): Promise<BudgetResponse> {
    await this.loadOwned(userId, id);

    if (dto.categoryId !== undefined) {
      await this.assertCategoryOwned(userId, dto.categoryId);
    }

    const data: Prisma.BudgetUpdateInput = {};
    if (dto.limitAmount !== undefined) {
      data.limitAmount = new Prisma.Decimal(dto.limitAmount);
    }
    if (dto.period !== undefined) {
      data.period = dto.period;
    }
    if (dto.categoryId !== undefined) {
      data.category = { connect: { id: dto.categoryId } };
    }

    await this.prisma.budget.updateMany({
      where: { id, ...ownerScope(userId) },
      data,
    });

    const updated = await this.loadOwned(userId, id);
    return toBudgetResponse(updated);
  }

  /**
   * Deletes an owned budget and returns a confirmation (Req 9.8, 9.9).
   *
   * A missing id or a non-owned budget both yield the non-disclosing not-found
   * (Req 9.9). The owner-scoped delete cannot touch another user's row.
   */
  async remove(
    userId: string,
    id: string,
  ): Promise<{ deleted: true; id: string }> {
    await this.loadOwned(userId, id);
    await this.prisma.budget.deleteMany({
      where: { id, ...ownerScope(userId) },
    });
    return { deleted: true, id };
  }

  /**
   * Computes the status of an owned budget (Req 10.1-10.5).
   *
   * Loads owner-scoped (missing/non-owned -> non-disclosing not-found, Req 10.4)
   * then sums the user's in-scope, in-period expense amounts and derives:
   *   - total     = sum of matching amounts (0 when none, Req 10.5)
   *   - remaining = limit - total (Req 10.1)
   *   - status    = within_limit when 0 <= total <= limit (remaining >= 0),
   *                 else exceeded (Req 10.2, 10.3)
   *   - exceeded  = total - limit, present only when exceeded (Req 10.3)
   *
   * The period window is derived from the budget's period relative to `now` in
   * the configured PLATFORM_TIMEZONE (A3). `now` is injectable so the
   * computation is deterministic and testable (Property 25). All arithmetic
   * uses `Prisma.Decimal` to preserve precision.
   */
  async getStatus(
    userId: string,
    id: string,
    now: Date = new Date(),
  ): Promise<BudgetStatusResponse> {
    const budget = await this.loadOwned(userId, id);

    const window = computePeriodWindow(
      budget.period,
      now,
      this.config.platformTimezone,
    );

    const aggregate = await this.prisma.expense.aggregate({
      _sum: { amount: true },
      where: {
        ...ownerScope(userId),
        ...(budget.categoryId ? { categoryId: budget.categoryId } : {}),
        date: {
          gte: windowBoundToDate(window.start),
          lte: windowBoundToDate(window.end),
        },
      },
    });

    const limit = budget.limitAmount;
    const total = aggregate._sum.amount ?? new Prisma.Decimal(0);
    const remaining = limit.minus(total);
    const isExceeded = total.greaterThan(limit);

    const response: BudgetStatusResponse = {
      budgetId: budget.id,
      period: budget.period,
      limit: limit.toFixed(2),
      total: total.toFixed(2),
      remaining: remaining.toFixed(2),
      status: isExceeded ? 'exceeded' : 'within_limit',
    };
    if (isExceeded) {
      response.exceeded = total.minus(limit).toFixed(2);
    }
    return response;
  }

  /**
   * Loads a single owned budget or throws the non-disclosing not-found when it
   * is missing OR owned by someone else (Req 9.9, 10.4, 3.2).
   */
  private async loadOwned(userId: string, id: string): Promise<Budget> {
    const budget = await this.prisma.budget.findFirst({
      where: { id, ...ownerScope(userId) },
    });
    return assertOwnership(budget, userId);
  }
}
