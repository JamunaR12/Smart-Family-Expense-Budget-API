import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * Machine-readable code for a not-found / not-owner single-resource access.
 *
 * Per Req 3.2 a non-owner request must NOT disclose the contents OR existence
 * of the resource, so "not found" and "not owned" collapse to the SAME
 * response. The global `AllExceptionsFilter` (task 7.1) maps this to a 404.
 */
export const NOT_FOUND_CODE = 'NOT_FOUND';

/**
 * The set of owner-scoped Prisma models an {@link OwnershipGuard} can protect.
 * Extended as resource modules land in Phases 4-6 (expense, category, budget).
 */
export type OwnedModel = 'expense' | 'category' | 'budget';

/** Metadata attached by {@link RequireOwnership} describing the guarded resource. */
export interface OwnershipMetadata {
  /** The Prisma model to load the resource from. */
  model: OwnedModel;
  /** The route param that carries the resource id (defaults to `id`). */
  idParam?: string;
}

/** Reflector metadata key for {@link RequireOwnership}. */
export const OWNERSHIP_KEY = 'ownership';

/**
 * Route decorator declaring that the target `/:id` route is owner-scoped.
 *
 * Applied by the resource controllers in Phases 4-6, e.g.
 * `@RequireOwnership({ model: 'expense' })`. The {@link OwnershipGuard} reads
 * this metadata to load and authorize the resource.
 */
export const RequireOwnership = (metadata: OwnershipMetadata) =>
  SetMetadata(OWNERSHIP_KEY, metadata);

/**
 * Backstop assertion used by services and the guard.
 *
 * Throws the non-disclosing not-found response when `resource` is absent or is
 * not owned by `userId`, so callers cannot tell "does not exist" apart from
 * "belongs to someone else" (Req 3.2). Returns the resource (typed) when the
 * caller is the Account_Owner.
 *
 * @param resource the loaded resource (or null when it does not exist)
 * @param userId the authenticated user's id
 */
export function assertOwnership<T extends { userId: string }>(
  resource: T | null | undefined,
  userId: string,
): T {
  if (!resource || resource.userId !== userId) {
    throw new NotFoundException({
      code: NOT_FOUND_CODE,
      message: 'The requested resource does not exist',
    });
  }
  return resource;
}

/**
 * Generic ownership guard for single-resource (`/:id`) routes.
 *
 * The primary Data_Isolation mechanism in this design is owner-scoped queries
 * inside each service (every read/write filters by `userId = currentUser.id`,
 * so collections only ever contain the owner's records — Req 3.3). This guard
 * is the single-resource BACKSTOP for `/:id` routes: it loads the resource by
 * id and applies {@link assertOwnership}, denying non-owners without disclosing
 * existence (Req 3.1, 3.2).
 *
 * It is driven by {@link RequireOwnership} metadata so it stays generic across
 * the resource modules (expense/category/budget) added in later phases. When a
 * route carries no ownership metadata the guard is a no-op (ownership is then
 * enforced by the service's owner-scoped query).
 */
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.getAllAndOverride<
      OwnershipMetadata | undefined
    >(OWNERSHIP_KEY, [context.getHandler(), context.getClass()]);

    // No ownership metadata: the service's owner-scoped query enforces isolation.
    if (!metadata) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AuthenticatedUser | undefined;
    const idParam = metadata.idParam ?? 'id';
    const resourceId = request.params?.[idParam];

    // No authenticated user (should be blocked by JwtAuthGuard first) or no id:
    // deny with the non-disclosing not-found response.
    if (!user || !resourceId) {
      throw new NotFoundException({
        code: NOT_FOUND_CODE,
        message: 'The requested resource does not exist',
      });
    }

    // Prisma model delegates share a `findUnique` shape; index dynamically by
    // the configured model name. Cast is confined to this generic lookup.
    const delegate = (
      this.prisma as unknown as Record<
        string,
        { findUnique: (args: unknown) => Promise<{ userId: string } | null> }
      >
    )[metadata.model];

    const resource = await delegate.findUnique({
      where: { id: resourceId },
    });

    assertOwnership(resource, user.id);
    return true;
  }
}
