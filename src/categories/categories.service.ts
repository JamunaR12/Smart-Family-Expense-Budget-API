import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Category } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ownerScope } from '../common/owner-scope';
import { assertOwnership } from '../common/guards/ownership.guard';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryResponse, toCategoryResponse } from './dto/category-response';

/** Machine-readable code for a field-level validation failure (Req 13.4). */
export const VALIDATION_ERROR_CODE = 'VALIDATION_ERROR';
/** Machine-readable code for a conflict (uniqueness / dependency) (Req 8.3, 8.7). */
export const CONFLICT_CODE = 'CONFLICT';

/** Minimum category name length after trimming (Req 8.1). */
export const CATEGORY_NAME_MIN = 1;
/** Maximum category name length after trimming (Req 8.1, 8.2). */
export const CATEGORY_NAME_MAX = 100;

/** Prisma unique-constraint violation code. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

/**
 * Category business logic (Req 8).
 *
 * Data_Isolation is enforced by owner-scoping EVERY query with
 * `ownerScope(userId)` (Req 3.3): single-resource reads/updates/deletes add
 * `userId` to the `where` clause so a category owned by someone else — or one
 * that does not exist — collapses to the SAME non-disclosing not-found response
 * (Req 8.6, 3.2). List queries only ever return the owner's rows and yield an
 * empty list when none exist (Req 8.4).
 *
 * Name normalization (trim) and the 1-100-char length + case-insensitive
 * uniqueness rules are the SINGLE source of truth here (Req 8.1-8.3, 8.5), so a
 * trailing-space or case variant of an existing name is consistently rejected.
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Trims the name and validates the 1-100-char rule AFTER trimming (Req 8.1,
   * 8.2). Returns the trimmed display name and its case-folded form used for
   * uniqueness. Throws a field-level VALIDATION_ERROR naming `name` when the
   * trimmed value is empty (all-whitespace) or exceeds the limit.
   */
  private normalizeName(name: string): { name: string; nameCi: string } {
    const trimmed = name.trim();
    if (trimmed.length < CATEGORY_NAME_MIN) {
      throw new BadRequestException({
        code: VALIDATION_ERROR_CODE,
        message: 'name must not be empty after trimming',
        details: [{ field: 'name', reason: 'name is empty' }],
      });
    }
    if (trimmed.length > CATEGORY_NAME_MAX) {
      throw new BadRequestException({
        code: VALIDATION_ERROR_CODE,
        message: `name must be at most ${CATEGORY_NAME_MAX} characters after trimming`,
        details: [{ field: 'name', reason: 'name is too long' }],
      });
    }
    return { name: trimmed, nameCi: trimmed.toLowerCase() };
  }

  /**
   * Creates a category owned by the user (Req 8.1-8.3).
   *
   * Rejects an all-whitespace / over-length name (VALIDATION_ERROR) and a
   * case-insensitive duplicate among the user's categories (CONFLICT) before
   * any write. A concurrent insert racing the uniqueness check surfaces as the
   * SAME conflict via the P2002 handler (Req 8.3).
   */
  async create(
    userId: string,
    dto: CreateCategoryDto,
  ): Promise<CategoryResponse> {
    const { name, nameCi } = this.normalizeName(dto.name);
    await this.assertNameAvailable(userId, nameCi);

    try {
      const created = await this.prisma.category.create({
        data: { userId, name, nameCi },
      });
      return toCategoryResponse(created);
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  /** Returns the user's categories owner-scoped; empty when none (Req 8.4). */
  async findMany(userId: string): Promise<CategoryResponse[]> {
    const rows = await this.prisma.category.findMany({
      where: { ...ownerScope(userId) },
      orderBy: [{ name: 'asc' }],
    });
    return rows.map(toCategoryResponse);
  }

  /**
   * Updates an owned category's name (Req 8.5, 8.6).
   *
   * Loads owner-scoped first: a missing id or a non-owned category both yield
   * the non-disclosing not-found (Req 8.6). The new name is trimmed and must be
   * 1-100 chars and case-insensitively unique among the user's OTHER categories
   * (the category itself is excluded so a no-op rename is allowed) (Req 8.5).
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<CategoryResponse> {
    await this.loadOwned(userId, id);
    const { name, nameCi } = this.normalizeName(dto.name);
    await this.assertNameAvailable(userId, nameCi, id);

    try {
      await this.prisma.category.updateMany({
        where: { id, ...ownerScope(userId) },
        data: { name, nameCi },
      });
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }

    const updated = await this.loadOwned(userId, id);
    return toCategoryResponse(updated);
  }

  /**
   * Deletes an owned category (Req 8.6, 8.7, 8.8).
   *
   * A missing/non-owned category yields the non-disclosing not-found (Req 8.6).
   * Deletion is BLOCKED with a conflict when one or more of the user's expenses
   * reference the category (Req 8.7); the explicit owner-scoped count check
   * produces a clean CONFLICT rather than relying on the DB Restrict FK (which
   * remains a backstop). When unreferenced the category is removed (Req 8.8).
   */
  async remove(
    userId: string,
    id: string,
  ): Promise<{ deleted: true; id: string }> {
    await this.loadOwned(userId, id);

    // Multi-step, atomic (Req 13.5, Property 29): the reference count and the
    // delete run inside one interactive transaction so no other write can add
    // an expense referencing this category BETWEEN the count and the delete
    // (a TOCTOU that would otherwise orphan the FK / bypass the Req 8.7 guard).
    // Throwing inside the callback rolls the whole unit back — nothing is
    // partially persisted.
    await this.prisma.$transaction(async (tx) => {
      const referencing = await tx.expense.count({
        where: { categoryId: id, ...ownerScope(userId) },
      });
      if (referencing > 0) {
        throw new ConflictException({
          code: CONFLICT_CODE,
          message:
            'category cannot be deleted while it is referenced by one or more expenses',
          details: [
            { field: 'id', reason: `referenced by ${referencing} expense(s)` },
          ],
        });
      }

      await tx.category.deleteMany({
        where: { id, ...ownerScope(userId) },
      });
    });

    return { deleted: true, id };
  }

  /**
   * Loads a single owned category or throws the non-disclosing not-found when
   * it is missing OR owned by someone else (Req 8.6, 3.2).
   */
  private async loadOwned(userId: string, id: string): Promise<Category> {
    const category = await this.prisma.category.findFirst({
      where: { id, ...ownerScope(userId) },
    });
    return assertOwnership(category, userId);
  }

  /**
   * Rejects a case-insensitive duplicate name among the user's categories
   * (Req 8.3). When `excludeId` is provided (update), the category itself is
   * excluded so a no-op / case-preserving rename is permitted (Req 8.5).
   */
  private async assertNameAvailable(
    userId: string,
    nameCi: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.prisma.category.findFirst({
      where: {
        ...ownerScope(userId),
        nameCi,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: CONFLICT_CODE,
        message: 'a category with this name already exists',
        details: [{ field: 'name', reason: 'duplicate name' }],
      });
    }
  }

  /**
   * Maps a Prisma unique-constraint race (P2002 on `(userId, nameCi)`) to the
   * SAME conflict returned by the pre-check, so a concurrent create/rename is
   * indistinguishable from a sequential one (Req 8.3).
   */
  private mapUniqueViolation(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === PRISMA_UNIQUE_VIOLATION
    ) {
      return new ConflictException({
        code: CONFLICT_CODE,
        message: 'a category with this name already exists',
        details: [{ field: 'name', reason: 'duplicate name' }],
      });
    }
    return error;
  }
}
