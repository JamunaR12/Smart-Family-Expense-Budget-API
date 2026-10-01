import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../../config/app-config.service';
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
  constructor(config: AppConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtSecret,
    });
  }

  /**
   * Maps a verified payload to the request principal. passport-jwt has already
   * validated the signature and expiry before this runs.
   */
  validate(payload: JwtPayload): AuthenticatedUser {
    return { id: payload.sub, email: payload.email };
  }
}
