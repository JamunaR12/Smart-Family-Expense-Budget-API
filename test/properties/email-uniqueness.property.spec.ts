import { execFileSync } from 'node:child_process';
import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as fc from 'fast-check';
import { AuthService, CONFLICT_CODE } from '../../src/auth/auth.service';
import { PasswordHasher } from '../../src/auth/password-hasher';
import { UsersService } from '../../src/users/users.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { TokenService } from '../../src/auth/token.service';
import type { LockoutService } from '../../src/auth/lockout.service';

/**
 * // Feature: smart-expense-insights-platform, Property 15
 *
 * Property 15: Case-insensitive email uniqueness (Req 1.2).
 *
 * DB-GATED. Registration persistence + the unique `emailCi` index are exercised
 * against a real database, so this runs only when DATABASE_TEST_URL is set
 * (skipped otherwise). Drives the REAL {@link AuthService.register} with real
 * {@link UsersService}/{@link PasswordHasher} over a real PrismaClient: for any
 * email, registering it and then registering ANY case-variant yields a
 * CONFLICT, and exactly ONE user exists for that email.
 */
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeDb = DATABASE_TEST_URL ? describe : describe.skip;

describeDb('Property 15 — case-insensitive email uniqueness (Req 1.2)', () => {
  let prisma: PrismaClient;
  let auth: AuthService;

  beforeAll(() => {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: DATABASE_TEST_URL },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    prisma = new PrismaClient({
      datasources: { db: { url: DATABASE_TEST_URL } },
    });

    const users = new UsersService(prisma as unknown as PrismaService);
    const hasher = new PasswordHasher();
    // Registration never issues a token or touches lockout, so stubs suffice.
    const tokens = {} as unknown as TokenService;
    const lockout = {} as unknown as LockoutService;
    auth = new AuthService(users, hasher, tokens, lockout);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    await prisma.budget.deleteMany();
    await prisma.expense.deleteMany();
    await prisma.category.deleteMany();
    await prisma.user.deleteMany();
  });

  /** Randomly re-cases each character of an email to produce a case-variant. */
  const recaseArb = (email: string) =>
    fc
      .array(fc.boolean(), { minLength: email.length, maxLength: email.length })
      .map((flags) =>
        email
          .split('')
          .map((ch, i) => (flags[i] ? ch.toUpperCase() : ch.toLowerCase()))
          .join(''),
      );

  it('a case-variant registration conflicts and exactly one user exists', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress().filter((e) => e.length >= 3 && e.length <= 254),
        fc.constant('ValidPass1!'),
        async (email, password) => {
          await prisma.user.deleteMany();

          // First registration succeeds.
          const created = await auth.register({ email, password });
          expect(created.id).toBeTruthy();

          // Any case-variant must conflict.
          const variant = fc.sample(recaseArb(email), 1)[0];
          let conflicted = false;
          try {
            await auth.register({ email: variant, password });
          } catch (error) {
            conflicted = true;
            expect(error).toBeInstanceOf(ConflictException);
            const response = (error as ConflictException).getResponse() as {
              code: unknown;
            };
            expect(response.code).toBe(CONFLICT_CODE);
          }
          expect(conflicted).toBe(true);

          // Exactly one user persists for that email.
          expect(await prisma.user.count()).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
