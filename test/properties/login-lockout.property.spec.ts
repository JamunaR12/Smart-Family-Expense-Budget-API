import { execFileSync } from 'node:child_process';
import { UnauthorizedException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as fc from 'fast-check';
import {
  LockoutService,
  ACCOUNT_LOCKED_CODE,
} from '../../src/auth/lockout.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { AppConfigService } from '../../src/config/app-config.service';

/**
 * // Feature: smart-expense-insights-platform, Property 12
 *
 * Property 12: Login lockout after threshold (Req 2.7).
 *
 * DB-GATED. Uses the persistent `LoginAttempt` store, so it runs only when
 * DATABASE_TEST_URL is set (skipped otherwise, mirroring the integration spec).
 * Drives the REAL {@link LockoutService} against a real PrismaClient with the
 * production thresholds (5 attempts / 15-minute window / 900s lock):
 *  - after 5 consecutive failures within the window the account is locked, and
 *    even a subsequent (correct-credential) attempt is refused with
 *    ACCOUNT_LOCKED for the 900s duration; and
 *  - a successful login BEFORE the threshold resets the consecutive-failure
 *    counter so the account is not locked by later isolated failures.
 */
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeDb = DATABASE_TEST_URL ? describe : describe.skip;

describeDb('Property 12 — login lockout after threshold (Req 2.7)', () => {
  const MAX_ATTEMPTS = 5;
  const WINDOW_MINUTES = 15;
  const LOCKOUT_SECONDS = 900;

  let prisma: PrismaClient;
  let lockout: LockoutService;

  beforeAll(() => {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: DATABASE_TEST_URL },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    prisma = new PrismaClient({
      datasources: { db: { url: DATABASE_TEST_URL } },
    });

    const config = {
      loginMaxAttempts: MAX_ATTEMPTS,
      loginWindowMinutes: WINDOW_MINUTES,
      loginLockoutSeconds: LOCKOUT_SECONDS,
    } as unknown as AppConfigService;

    lockout = new LockoutService(prisma as unknown as PrismaService, config);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    await prisma.loginAttempt.deleteMany();
  });

  /** Returns the thrown ACCOUNT_LOCKED error, or null if assertNotLocked passed. */
  const tryLock = async (
    email: string,
  ): Promise<UnauthorizedException | null> => {
    try {
      await lockout.assertNotLocked(email);
      return null;
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      return error as UnauthorizedException;
    }
  };

  it('locks an email for 900s after 5 consecutive failures within the window', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid().map((u) => `lockme-${u}@example.com`),
        async (email) => {
          await prisma.loginAttempt.deleteMany();

          // Below threshold: no lock yet.
          for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
            expect(await tryLock(email)).toBeNull();
            await lockout.recordFailure(email);
          }
          // The 5th failure trips the lock.
          expect(await tryLock(email)).toBeNull();
          await lockout.recordFailure(email);

          // Now locked: even a would-be-correct attempt is refused up front.
          const locked = await tryLock(email);
          expect(locked).not.toBeNull();
          const response = locked!.getResponse() as { code: unknown };
          expect(response.code).toBe(ACCOUNT_LOCKED_CODE);

          // The lock persists ~900s into the future.
          const row = await prisma.loginAttempt.findUnique({
            where: { email },
          });
          expect(row?.lockedUntil).toBeTruthy();
          const remainingMs = row!.lockedUntil!.getTime() - Date.now();
          // Allow slack for test execution time; must be a positive ~900s window.
          expect(remainingMs).toBeGreaterThan((LOCKOUT_SECONDS - 30) * 1000);
          expect(remainingMs).toBeLessThanOrEqual(LOCKOUT_SECONDS * 1000);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a success before threshold resets the counter (no lock from later isolated failures)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid().map((u) => `reset-${u}@example.com`),
        fc.integer({ min: 1, max: MAX_ATTEMPTS - 1 }),
        async (email, failuresBeforeSuccess) => {
          await prisma.loginAttempt.deleteMany();

          // Some failures, then a success clears the state.
          for (let i = 0; i < failuresBeforeSuccess; i++) {
            await lockout.recordFailure(email);
          }
          await lockout.recordSuccess(email);

          // A fresh set of failures below threshold must NOT lock the account,
          // because the counter was reset.
          for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
            expect(await tryLock(email)).toBeNull();
            await lockout.recordFailure(email);
          }
          expect(await tryLock(email)).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});
