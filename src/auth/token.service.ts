import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';

/** JWT payload shape. Carries only non-secret identity claims. */
export interface JwtPayload {
  /** Subject — the user id. */
  sub: string;
  /** The user's email (convenience claim; not a secret). */
  email: string;
  /** Issued-at (seconds since epoch); set by `@nestjs/jwt`. */
  iat?: number;
  /** Expiry (seconds since epoch); set from `signOptions.expiresIn`. */
  exp?: number;
}

/** The token payload returned to the client on successful login. */
export interface IssuedToken {
  accessToken: string;
  tokenType: 'Bearer';
  /** Lifetime in seconds (3600 by default, Req 2.4). */
  expiresIn: number;
}

/**
 * Issues signed JWT Authentication_Tokens (Req 2.4, Validates Property 10).
 *
 * The signing secret and expiry come from configuration
 * (`JWT_SECRET`, `JWT_EXPIRES_IN`, default 3600s) and are wired into
 * `JwtModule` in `AuthModule`. Every issued token therefore has
 * `exp = iat + expiresIn`, i.e. exactly 3600 seconds after issuance by default
 * (Req 2.4). No secret material is placed in the payload.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
  ) {}

  /** Signs a token for the given user with the configured secret and expiry. */
  async issueToken(user: Pick<User, 'id' | 'email'>): Promise<IssuedToken> {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessToken = await this.jwtService.signAsync(payload);
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.jwtExpiresIn,
    };
  }
}
