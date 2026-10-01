import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The authenticated principal attached to the request by the JWT strategy
 * (`JwtStrategy.validate`). Deliberately minimal — it carries only the
 * non-secret identity needed for owner-scoped queries and ownership checks
 * (Req 3.1, 3.3). No token or credential material is ever placed here.
 */
export interface AuthenticatedUser {
  /** The account owner's user id (from the JWT `sub` claim). */
  id: string;
  /** The account owner's email (from the JWT `email` claim). */
  email: string;
}

/**
 * Parameter decorator that returns the authenticated user from `req.user`.
 *
 * Populated by the passport JWT strategy after the global `JwtAuthGuard`
 * validates the token, so controllers/services can scope every query to
 * `userId = currentUser.id` (Data_Isolation, Req 3.3).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user as AuthenticatedUser | undefined;
  },
);
