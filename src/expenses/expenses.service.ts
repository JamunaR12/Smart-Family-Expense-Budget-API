import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Expense } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { ownerScope } from '../common/owner-scope';
import {
  assertOwnership,
  NOT_FOUND_CODE,
} from '../common/guards/ownership.guard';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ListExpensesQueryDto } from './dto/list-expenses-query.dto';
import { ExpenseResponse, toExpenseResponse } from './dto/expense-response';
import { parseCalendarDate, todayInZone } from './dto/expense-date.validator';

/** Machine-readable code for a field-level validation failure (Req 13.4). */
export const VALIDATION_ERROR_CODE = 'VALIDATION_ERROR';

/** Result of a list query: the shaped page plus its total (owner-scoped). */
export interface ExpenseListResult {
  data: ExpenseResponse[];
  meta: { pagination: { limit: number; offset: number; total: number } };
}

/**
 * Expense business logic (Req 4-7).
 *
 * Data_Isolation is enforced by owner-scoping EVERY query with
 * `ownerScope(userId)` (Req 3.3): single-resource reads/updates/deletes add
 * `userId` to the `where` clause so a resource owned by someone else — or one
 * that does not exist — collapses to the SAME non-disclosing not-found response
 * (Req 5.8, 6.6, 7.3, 3.2). List/collection queries only ever return the
 * owner's rows and yield an empty page when none match (Req 5.6).
 *
 * Money is handled as `Prisma.Decimal` to preserve two-decimal precision; the
 * response mapper serializes it to a string (design ADR-5).
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Builds a date-only `Date` (UTC midnight) from a validated `YYYY-MM-DD`
   * string so it maps cleanly onto the `@db.Date` column (A3).
   */
  private toDateOnly(value: string): Date {
    const parts = parseCalendarDate(value);
    // parseCalendarDate has already run in the DTO validator; a null here would
    // be a programming error, but guard defensively.
    if (!parts) {
      throw new BadRequestException({
        code: VALIDATION_ERROR_CODE,
        message: 'date must be a valid calendar date in YYYY-MM-DD format',
        details: [{ field: 'date', reason: 'invalid calendar date' }],
      });
    }
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  }

  /**
   * Rejects a future date (Req 4.5, 6.1). "Today" is evaluated in the
   * configured `PLATFORM_TIMEZONE` (A3) and compared at day granularity, so an
   * expense dated today (in that zone) is always accepted.
   */
  private assertNotFuture(value: string): void {
    const today = todayInZone(this.config.platformTimezone);
    // Lexicographic comparison of `YYYY-MM-DD` strings equals chronological
    // comparison, so no timezone math is needed beyond resolving "today".
    if (value > today) {
      throw new BadRequestException({
        code: VALIDATION_ERROR_CODE,
        message: 'date must not be in the future',
        details: [{ field: 'date', reason: 'date is in the future' }],
      });
    }
  }

  /**
   * Verifies the referenced category exists AND is owned by the user (Req 4.3,
   * 6.4). A missing/foreign category is a VALIDATION error (the category is
   * invalid for this user), NOT a not-found, and no expense is created/modified.
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
        message: 'categoryId is invalid or not owned by the user',
        details: [{ field: 'categoryId', reason: 'category is invalid' }],
      });
    }
  }

  /**
   * Creates an expense owned by the user (Req 4.1-4.6).
   *
   * Validates the not-future date and category ownership BEFORE any write, so a
   * rejected request never persists a record (Req 4.2, 4.3).
   */
  async create(
    userId: string,
    dto: CreateExpenseDto,
  ): Promise<ExpenseResponse> {
    this.assertNotFuture(dto.date);
    await this.assertCategoryOwned(userId, dto.categoryId);

    const created = await this.prisma.expense.create({
      data: {
        userId,
        categoryId: dto.categoryId,
        amount: new Prisma.Decimal(dto.amount),
        currency: dto.currency.toUpperCase(),
        date: this.toDateOnly(dto.date),
        description: dto.description ?? null,
      },
    });

    return toExpenseResponse(created);
  }

  /**
   * Loads a single owned expense or throws the non-disclosing not-found
   * response when it is missing OR owned by someone else (Req 5.1, 5.7, 5.8).
   */
  private async loadOwned(userId: string, id: string): Promise<Expense> {
    const expense = await this.prisma.expense.findFirst({
      where: { id, ...ownerScope(userId) },
    });
    // assertOwnership collapses "missing" and "not owned" into one 404
    // (Req 3.2); the owner-scoped where clause already guarantees this, and the
    // assertion makes the intent explicit and type-narrows the result.
    return assertOwnership(expense, userId);
  }

  /** Returns a single owned expense (Req 5.1, 5.7, 5.8). */
  async findOne(userId: string, id: string): Promise<ExpenseResponse> {
    const expense = await this.loadOwned(userId, id);
    return toExpenseResponse(expense);
  }

  /**
   * Lists the user's expenses with optional filters, ordering, and pagination
   * (Req 5.2-5.6). Returns an owner-scoped page ordered by date descending with
   * pagination metadata; an empty page when nothing matches (Req 5.6).
   */
  async findMany(
    userId: string,
    query: ListExpensesQueryDto,
  ): Promise<ExpenseListResult> {
    // Cross-field range check (Req 5.10): start must not be after end.
    if (query.startDate && query.endDate && query.startDate > query.endDate) {
      throw new BadRequestException({
        code: VALIDATION_ERROR_CODE,
        message: 'startDate must be on or before endDate',
        details: [{ field: 'startDate', reason: 'range start after end' }],
      });
    }

    // Inclusive date range on both boundaries (Req 5.3).
    const dateFilter: Prisma.DateTimeFilter = {};
    if (query.startDate) {
      dateFilter.gte = this.toDateOnly(query.startDate);
    }
    if (query.endDate) {
      dateFilter.lte = this.toDateOnly(query.endDate);
    }

    const where: Prisma.ExpenseWhereInput = {
      ...ownerScope(userId),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.startDate || query.endDate ? { date: dateFilter } : {}),
    };

    // Count + page in a single transaction for a consistent total (Req 5.5).
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.expense.count({ where }),
      this.prisma.expense.findMany({
        where,
        // Default ordering: expense date descending (Req 5.2). `createdAt` is a
        // stable tiebreaker for rows sharing a date so paging is deterministic.
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: query.offset,
        take: query.limit,
      }),
    ]);

    return {
      data: rows.map(toExpenseResponse),
      meta: {
        pagination: {
          limit: query.limit,
          offset: query.offset,
          total,
        },
      },
    };
  }

  /**
   * Updates an owned expense (Req 6.1-6.6).
   *
   * Loads owner-scoped first: a missing id or a non-owned expense both yield the
   * non-disclosing not-found (Req 6.5, 6.6). Any invalid field (amount/date/
   * category) is rejected BEFORE the write, leaving the stored expense unchanged
   * (Req 6.2, 6.3, 6.4). Only provided fields are applied (partial update).
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateExpenseDto,
  ): Promise<ExpenseResponse> {
    // Ensure the expense exists and belongs to the user before validating/
    // mutating anything (Req 6.5, 6.6).
    await this.loadOwned(userId, id);

    if (dto.date !== undefined) {
      this.assertNotFuture(dto.date);
    }
    if (dto.categoryId !== undefined) {
      await this.assertCategoryOwned(userId, dto.categoryId);
    }

    const data: Prisma.ExpenseUpdateInput = {};
    if (dto.amount !== undefined) {
      data.amount = new Prisma.Decimal(dto.amount);
    }
    if (dto.currency !== undefined) {
      data.currency = dto.currency.toUpperCase();
    }
    if (dto.date !== undefined) {
      data.date = this.toDateOnly(dto.date);
    }
    if (dto.description !== undefined) {
      data.description = dto.description;
    }
    if (dto.categoryId !== undefined) {
      data.category = { connect: { id: dto.categoryId } };
    }

    // Owner-scoped updateMany guarantees the write cannot touch another user's
    // row even if `id` were somehow reused; we already asserted ownership above.
    await this.prisma.expense.updateMany({
      where: { id, ...ownerScope(userId) },
      data,
    });

    const updated = await this.loadOwned(userId, id);
    return toExpenseResponse(updated);
  }

  /**
   * Deletes an owned expense and returns a confirmation (Req 7.1-7.3).
   *
   * A missing/invalid id or a non-owned expense both yield the non-disclosing
   * not-found, leaving any existing expense unchanged (Req 7.2, 7.3).
   */
  async remove(
    userId: string,
    id: string,
  ): Promise<{ deleted: true; id: string }> {
    await this.loadOwned(userId, id);

    // Owner-scoped delete: the where clause makes it impossible to delete
    // another user's row (Req 7.3).
    const result = await this.prisma.expense.deleteMany({
      where: { id, ...ownerScope(userId) },
    });

    // Defensive: if a concurrent delete removed it first, surface not-found
    // rather than a false confirmation (Req 7.2).
    if (result.count === 0) {
      throw new NotFoundException({
        code: NOT_FOUND_CODE,
        message: 'The requested resource does not exist',
      });
    }

    return { deleted: true, id };
  }
}
