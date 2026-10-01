import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import * as fc from 'fast-check';
import { RegisterDto } from '../../src/auth/dto/register.dto';

/**
 * // Feature: smart-expense-insights-platform, Property 14
 *
 * Property 14: Registration validation (Req 1.3, 1.4).
 *
 * PURE / NO-DB. Exercises the {@link RegisterDto} contract directly through
 * class-validator (`plainToInstance` + `validate`), which is exactly what the
 * global `ValidationPipe` runs before any business logic. For arbitrary invalid
 * emails (bad format, or outside 3-254 chars) and invalid passwords (outside
 * 8-128 chars, or missing a required character class) validation FAILS with an
 * error naming the offending field; for arbitrary VALID pairs it PASSES.
 */
describe('Property 14 — registration validation (Req 1.3, 1.4)', () => {
  /** Runs the DTO validators and returns the failing property names. */
  const failingFields = async (
    email: unknown,
    password: unknown,
  ): Promise<string[]> => {
    const dto = plainToInstance(RegisterDto, { email, password });
    const errors: ValidationError[] = await validate(dto);
    return errors.map((e) => e.property);
  };

  // A password that satisfies every rule: 8-128 chars, upper+lower+digit+special.
  const validPasswordArb = fc
    .tuple(
      fc.stringMatching(/^[a-z]{2,20}$/),
      fc.stringMatching(/^[A-Z]{2,20}$/),
      fc.stringMatching(/^[0-9]{2,20}$/),
      fc.constantFrom('!', '@', '#', '$', '%', '^', '&', '*', '?', '-'),
    )
    .map(
      ([lower, upper, digit, special]) => `${lower}${upper}${digit}${special}`,
    )
    .filter((p) => p.length >= 8 && p.length <= 128);

  // A well-formed email within the 3-254 length bound.
  const validEmailArb = fc
    .emailAddress()
    .filter((e) => e.length >= 3 && e.length <= 254);

  it('accepts arbitrary valid email/password pairs', async () => {
    await fc.assert(
      fc.asyncProperty(
        validEmailArb,
        validPasswordArb,
        async (email, password) => {
          expect(await failingFields(email, password)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects invalid emails naming the email field (with a valid password)', async () => {
    const invalidEmailArb = fc.oneof(
      // Not an email at all.
      fc
        .string({ minLength: 3, maxLength: 40 })
        .filter((s) => !s.includes('@')),
      // Too short (< 3 chars).
      fc.constantFrom('a', 'ab', '@', 'x'),
      // Too long (> 254 chars) but still shaped like an email.
      fc
        .integer({ min: 255, max: 400 })
        .map((n) => `${'a'.repeat(n - 12)}@example.com`),
    );

    await fc.assert(
      fc.asyncProperty(
        invalidEmailArb,
        validPasswordArb,
        async (email, password) => {
          const fields = await failingFields(email, password);
          expect(fields).toContain('email');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects invalid passwords naming the password field (with a valid email)', async () => {
    const invalidPasswordArb = fc.oneof(
      // Too short (< 8) — also likely missing character classes.
      fc.string({ minLength: 0, maxLength: 7 }),
      // Too long (> 128).
      fc.integer({ min: 129, max: 200 }).map((n) => `Aa1!${'a'.repeat(n - 4)}`),
      // Length OK but missing a character class (letters only, no digit/special).
      fc.stringMatching(/^[a-z]{8,20}$/),
      // Length OK but only lowercase + digit (no uppercase, no special).
      fc.stringMatching(/^[a-z0-9]{8,20}$/),
    );

    await fc.assert(
      fc.asyncProperty(
        validEmailArb,
        invalidPasswordArb,
        async (email, password) => {
          const fields = await failingFields(email, password);
          expect(fields).toContain('password');
        },
      ),
      { numRuns: 100 },
    );
  });
});
