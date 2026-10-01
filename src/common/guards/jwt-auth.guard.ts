import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** Machine-readable code: a protected route was reached without a token (Req 3.4). */
export const AUTH_REQUIRED_CODE = 'AUTH_REQUIRED';

/** Machine-readable code: a token was present but expired/malformed/invalid (Req 2.5, 2.6, 3.5). */
export const AUTH_FAILED_CODE = 'AUTH_FAILED';

/**
 * Global authentication guard.
 *
 * Extends the passport `jwt` guard so every route requires a valid
 * Authentication_Token by default (Req 3.4), and honors the `@Public()`
 * metadata flag to let the unauthenticated auth endpoints and docs through.
 *
 * Registered globally in `configureApp()` (task 3.5) so local and Lambda share
 * identical auth behavior (Req 16.5).
 *
 * Error semantics (finalized by the global `AllExceptionsFilter`, task 7.1):
 * - No token on a protected route -> 401 `AUTH_REQUIRED` (Req 3.4).
 * - Expired / malformed / bad-signature token -> 401 `AUTH_FAILED` (Req 2.5,
 *   2.6, 3.5).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Opt-out for routes/controllers marked @Public() (register, login, docs).
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  /**
   * Maps passport outcomes to the auth error envelope without disclosing token
   * internals. Distinguishes "no token presented" (AUTH_REQUIRED) from
   * "token present but invalid" (AUTH_FAILED) using the passport `info`.
   */
  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: unknown,
  ): TUser {
    if (err || !user) {
      const infoName =
        info && typeof info === 'object' && 'name' in info
          ? String((info as { name?: unknown }).name)
          : undefined;

      // passport-jwt reports "No auth token" when the header is absent.
      const infoMessage =
        info && typeof info === 'object' && 'message' in info
          ? String((info as { message?: unknown }).message)
          : undefined;

      const noToken =
        infoName === 'Error' && infoMessage === 'No auth token'
          ? true
          : infoMessage === 'No auth token';

      if (noToken) {
        throw new UnauthorizedException({
          code: AUTH_REQUIRED_CODE,
          message: 'Authentication is required to access this resource',
        });
      }

      // Expired, malformed, or bad-signature token (Req 2.5, 2.6, 3.5).
      throw new UnauthorizedException({
        code: AUTH_FAILED_CODE,
        message: 'Authentication failed',
      });
    }
    return user;
  }
}
