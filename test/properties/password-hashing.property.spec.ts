import * as fc from 'fast-check';
import { PasswordHasher } from '../../src/auth/password-hasher';

/**
 * // Feature: smart-expense-insights-platform, Property 13
 *
 * Property 13: Password stored only as a unique salted hash (Req 1.5).
 *
 * PURE / NO-DB. Uses the REAL {@link PasswordHasher} (argon2id). For arbitrary
 * passwords we assert:
 *  - the stored hash does NOT equal the plaintext;
 *  - verify(hash, plaintext) === true;
 *  - verify(hash, wrongPlaintext) === false;
 *  - hashing the SAME password twice yields DIFFERENT hashes (unique per-user
 *    salt embedded by argon2), so two users with the same password never share
 *    a stored credential.
 *
 * NUMRUNS NOTE (crypto cost): argon2id is intentionally memory-hard and each
 * hash is expensive; this property performs THREE argon2 operations per run
 * (two hashes + verifies). Running 100 iterations would take minutes and risk
 * flaky timeouts. Per the task's explicit allowance for the argon2 property, we
 * cap this ONE property at `numRuns: 25` (with a raised per-test timeout) as a
 * deliberate crypto-cost tradeoff; every other property keeps numRuns >= 100.
 */
describe('Property 13 — password stored only as a unique salted hash (Req 1.5)', () => {
  const hasher = new PasswordHasher();

  it('hash is non-plaintext, verifies correctly, and is uniquely salted', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Non-empty passwords; a couple of distinct real strings per run keep
        // the argon2 workload bounded while still varying the input.
        fc.string({ minLength: 8, maxLength: 64 }),
        async (password) => {
          const hash1 = await hasher.hash(password);
          const hash2 = await hasher.hash(password);

          // The plaintext is never the stored value.
          expect(hash1).not.toBe(password);

          // The hash verifies against the correct plaintext.
          await expect(hasher.verify(hash1, password)).resolves.toBe(true);

          // A different plaintext must not verify.
          const wrong = password + 'X';
          await expect(hasher.verify(hash1, wrong)).resolves.toBe(false);

          // Unique per-user salt: the same password hashed twice differs.
          expect(hash1).not.toBe(hash2);
          // Both independently hashed credentials still verify.
          await expect(hasher.verify(hash2, password)).resolves.toBe(true);
        },
      ),
      { numRuns: 25 },
    );
  }, 120_000);
});
