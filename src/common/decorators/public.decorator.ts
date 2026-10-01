import { SetMetadata, CustomDecorator } from '@nestjs/common';

/**
 * Metadata key set by {@link Public} and read by the global `JwtAuthGuard`
 * (task 3.5) to opt a route out of authentication.
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route (or controller) as public so the global `JwtAuthGuard` allows
 * it through without an Authentication_Token.
 *
 * Used for the unauthenticated auth endpoints (`/auth/register`, `/auth/login`)
 * and the docs surface; every other route requires a valid token (Req 3.4).
 */
export const Public = (): CustomDecorator<string> =>
  SetMetadata(IS_PUBLIC_KEY, true);
