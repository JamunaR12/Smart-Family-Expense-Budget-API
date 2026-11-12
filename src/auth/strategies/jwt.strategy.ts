import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../../config/app-config.service';
import { UsersService } from '../../users/users.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../token.service';

/**
 * Passport JWT strategy (Req 2.5, 2.6, 3.5).
 *
 * Extracts the Bearer token from the `Authorization` header and verifies it
 * against `JWT_SECRET`. `ignoreExpiration: false` makes passport-jwt reject an
 * expired token (Req 2.5); a malformed token or bad signature also fails
 * verification (Req 2.6, 3.5). In every failure case `JwtAuthGuard` maps the
 * outcome to a 401 without disclosing token internals.
 *
 * On success `validate()` returns the minimal, non-secret principal attached to
 * `req.user` and consumed by `@CurrentUser()` for owner-scoped queries.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: AppConfigService,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtSecret,
    });
  }

  /**
   * Maps a verified payload to the request principal. passport-jwt has already
   * validated the signature and expiry before this runs. The user is re-checked
   * against the database so a token issued to an account that no longer exists
   * stops working immediately instead of staying valid until expiry.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException();
    }
    return { id: user.id, email: user.email };
  }
}
