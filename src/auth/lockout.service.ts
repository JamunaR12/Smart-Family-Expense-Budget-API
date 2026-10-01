import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Machine-readable code for a temporarily-locked account (Req 2.7). Distinct
 * from the generic `AUTH_FAILED` so a locked account can be indicated, which
 * Req 2.7 explicitly permits ("indicating the account is temporarily locked").
 */
export const ACCOUNT_LOCKED_CODE = 'ACCOUNT_LOCKED';

/**
 * Login lockout tracking, backed by the shared `LoginAttempt` table (Req 2.7,
 * Validates Property 12; design ADR-7).
 *
 * State lives in PostgreSQL rather than in memory so lockout behaves
 * consistently across stateless, multi-container Lambda invocations. All state
 * is keyed by the normalized (lowercased) email.
 *
 * Algorithm (thresholds/durations sourced from `AppConfigService`):
 * - `loginMaxAttempts` (5): consecutive failures within the window that trigger
 *   a lock.
 * - `loginWindowMinutes` (15): the rolling failure window.
 * - `loginLockoutSeconds` (900): how long the account stays locked.
 *
 * A successful authentication resets the consecutive-failure counter (design
 * §Ambiguities item 10 recommendation).
 */
@Injectable()
export class LockoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Rejects the attempt when the email is currently locked (Req 2.7). Called
   * BEFORE credential verification so a locked account is refused even with
   * correct credentials.
   */
  async assertNotLocked(emailCi: string): Promise<void> {
    const attempt = await this.prisma.loginAttempt.findUnique({
      where: { email: emailCi },
    });

    if (attempt?.lockedUntil && attempt.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException({
        code: ACCOUNT_LOCKED_CODE,
        message: 'Account is temporarily locked. Please try again later.',
      });
    }
  }

  /**
   * Records a failed login attempt, advancing the rolling window and locking
   * the account when the failure threshold is reached (Req 2.7).
   */
  async recordFailure(emailCi: string): Promise<void> {
    const now = new Date();
    const windowMs = this.config.loginWindowMinutes * 60 * 1000;
    const maxAttempts = this.config.loginMaxAttempts;
    const lockoutMs = this.config.loginLockoutSeconds * 1000;

    const existing = await this.prisma.loginAttempt.findUnique({
      where: { email: emailCi },
    });

    // Start a fresh window if there is no prior record or the window expired.
    const windowExpired =
      !existing || now.getTime() - existing.windowStart.getTime() > windowMs;

    const failedCount = windowExpired ? 1 : existing.failedCount + 1;
    const windowStart = windowExpired ? now : existing.windowStart;
    const lockedUntil =
      failedCount >= maxAttempts ? new Date(now.getTime() + lockoutMs) : null;

    await this.prisma.loginAttempt.upsert({
      where: { email: emailCi },
      create: {
        email: emailCi,
        failedCount,
        windowStart,
        lockedUntil,
      },
      update: {
        failedCount,
        windowStart,
        lockedUntil,
      },
    });
  }

  /**
   * Clears failure state after a successful authentication so a subsequent
   * failure starts a fresh window (Req 2.7 "consecutive"; design §Ambiguities
   * item 10). Idempotent when no record exists.
   */
  async recordSuccess(emailCi: string): Promise<void> {
    await this.prisma.loginAttempt.deleteMany({ where: { email: emailCi } });
  }
}
