import { JwtService } from '@nestjs/jwt';
import * as fc from 'fast-check';

/**
 * // Feature: smart-expense-insights-platform, Property 9
 *
 * Property 9: Invalid token rejected (Req 2.5, 2.6, 3.5).
 *
 * PURE / NO-DB. The JWT-verification behavior that `JwtStrategy`/`JwtAuthGuard`
 * rely on is exercised directly through the REAL {@link JwtService} configured
 * with the same options as `AuthModule` (`ignoreExpiration: false`). For
 * arbitrary payloads we assert that:
 *  - EXPIRED tokens (signed with a negative/short lifetime) fail verification
 *    (Req 2.5);
 *  - MALFORMED tokens (arbitrary non-JWT strings) fail verification (Req 2.6);
 *  - BAD-SIGNATURE tokens (signed with a DIFFERENT secret) fail verification
 *    (Req 3.5);
 * while a freshly issued, correctly signed token verifies (control).
 *
 * `verify()` throwing (rather than returning) is the rejection: the strategy
 * surfaces it as a 401 `AUTH_FAILED` via the guard.
 */
describe('Property 9 — invalid token rejected (Req 2.5, 2.6, 3.5)', () => {
  const SECRET = 'property-9-real-secret';
  const OTHER_SECRET = 'property-9-attacker-secret';

  // Same options AuthModule uses for verification (expiry is enforced).
  const verifier = new JwtService({ secret: SECRET });
  const issuer = new JwtService({ secret: SECRET });
  const attacker = new JwtService({ secret: OTHER_SECRET });

  const payloadArb = fc.record({
    sub: fc.uuid(),
    email: fc.emailAddress(),
  });

  it('rejects expired tokens (Req 2.5)', () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        // exp already in the past → verification must reject.
        const expired = issuer.sign(payload, { expiresIn: -3600 });
        expect(() => verifier.verify(expired)).toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('rejects malformed tokens (Req 2.6)', () => {
    fc.assert(
      fc.property(fc.string(), (garbage) => {
        // Arbitrary strings are not verifiable JWTs.
        expect(() => verifier.verify(garbage)).toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('rejects bad-signature tokens signed with a different secret (Req 3.5)', () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        // Correctly-structured but signed with the WRONG secret.
        const forged = attacker.sign(payload, { expiresIn: 3600 });
        expect(() => verifier.verify(forged)).toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('control: a correctly signed, unexpired token verifies', () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        const valid = issuer.sign(payload, { expiresIn: 3600 });
        const decoded = verifier.verify(valid) as {
          sub: string;
          email: string;
        };
        expect(decoded.sub).toBe(payload.sub);
        expect(decoded.email).toBe(payload.email);
      }),
      { numRuns: 100 },
    );
  });
});
