import { JwtService } from '@nestjs/jwt';
import * as fc from 'fast-check';
import { TokenService } from '../../src/auth/token.service';
import type { AppConfigService } from '../../src/config/app-config.service';

/**
 * // Feature: smart-expense-insights-platform, Property 10
 *
 * Property 10: Token expiry is exactly 3600 seconds (Req 2.4).
 *
 * PURE / NO-DB. Uses the REAL {@link TokenService} wired to a REAL
 * {@link JwtService} configured with a test secret and `expiresIn` sourced from
 * a stubbed {@link AppConfigService} (3600s), exactly mirroring how `AuthModule`
 * wires `JwtModule`. For arbitrary user ids/emails the issued token is decoded
 * and we assert `exp - iat === 3600` — i.e. the token expires exactly
 * `JWT_EXPIRES_IN` seconds after issuance.
 */
describe('Property 10 — token expiry is exactly 3600 seconds (Req 2.4)', () => {
  const JWT_EXPIRES_IN = 3600;

  // Mirror AuthModule's JwtModule wiring: secret + numeric expiresIn (seconds),
  // so exp = iat + JWT_EXPIRES_IN.
  const jwtService = new JwtService({
    secret: 'property-10-test-secret',
    signOptions: { expiresIn: JWT_EXPIRES_IN },
  });

  // Minimal stub of AppConfigService exposing only what TokenService reads.
  const config = {
    jwtExpiresIn: JWT_EXPIRES_IN,
  } as unknown as AppConfigService;

  const tokenService = new TokenService(jwtService, config);

  it('every issued token has exp - iat === 3600 for arbitrary users', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.emailAddress(), async (id, email) => {
        const issued = await tokenService.issueToken({ id, email });

        // The service reports the configured lifetime to the client.
        expect(issued.tokenType).toBe('Bearer');
        expect(issued.expiresIn).toBe(JWT_EXPIRES_IN);

        // Decode the signed JWT and assert the claim-level lifetime.
        const decoded = jwtService.decode(issued.accessToken) as {
          sub: string;
          email: string;
          iat: number;
          exp: number;
        };

        expect(decoded.sub).toBe(id);
        expect(decoded.email).toBe(email);
        expect(typeof decoded.iat).toBe('number');
        expect(typeof decoded.exp).toBe('number');
        expect(decoded.exp - decoded.iat).toBe(JWT_EXPIRES_IN);
      }),
      { numRuns: 100 },
    );
  });
});
