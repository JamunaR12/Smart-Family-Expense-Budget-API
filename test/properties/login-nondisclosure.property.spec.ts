import { UnauthorizedException } from '@nestjs/common';
import * as fc from 'fast-check';
import type { User } from '@prisma/client';
import { AuthService } from '../../src/auth/auth.service';
import type { PasswordHasher } from '../../src/auth/password-hasher';
import type { TokenService } from '../../src/auth/token.service';
import type { LockoutService } from '../../src/auth/lockout.service';
import type { UsersService } from '../../src/users/users.service';

/**
 * // Feature: smart-expense-insights-platform, Property 11
 *
 * Property 11: Login errors do not disclose the failing field (Req 2.2).
 *
 * PURE / NO-DB. Drives the REAL {@link AuthService.login} with lightweight
 * in-memory fakes for its collaborators (UsersService, PasswordHasher,
 * TokenService, LockoutService). For arbitrary emails/passwords we compare the
 * two distinct failure branches:
 *  - "user not found"  (findByEmailCi -> null)
 *  - "password mismatch" (findByEmailCi -> user, verify -> false)
 * and assert the thrown error's `code` and `message` are IDENTICAL, so a
 * caller cannot tell which field was wrong.
 */
describe('Property 11 — login errors do not disclose the failing field (Req 2.2)', () => {
  // A no-op lockout so the login path reaches credential verification and the
  // generic rejection without any persistence.
  const lockout = {
    assertNotLocked: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
    recordSuccess: jest.fn().mockResolvedValue(undefined),
  } as unknown as LockoutService;

  const tokens = {
    issueToken: jest.fn(),
  } as unknown as TokenService;

  /** Extracts the {code, message} envelope from a thrown UnauthorizedException. */
  const captureError = async (
    service: AuthService,
    email: string,
    password: string,
  ): Promise<{ code: unknown; message: unknown }> => {
    try {
      await service.login({ email, password });
      throw new Error('expected login to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      const response = (error as UnauthorizedException).getResponse() as {
        code: unknown;
        message: unknown;
      };
      return { code: response.code, message: response.message };
    }
  };

  it('wrong-email and wrong-password rejections are identical for arbitrary inputs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        fc.string({ minLength: 1, maxLength: 128 }),
        async (email, password) => {
          // Branch A: user not found — findByEmailCi returns null.
          const usersNotFound = {
            findByEmailCi: jest.fn().mockResolvedValue(null),
          } as unknown as UsersService;
          const hasherNeverCalled = {
            verify: jest.fn().mockResolvedValue(false),
          } as unknown as PasswordHasher;
          const serviceNoUser = new AuthService(
            usersNotFound,
            hasherNeverCalled,
            tokens,
            lockout,
          );

          // Branch B: user exists but the password does not match.
          const fakeUser = {
            id: 'user-id',
            email,
            emailCi: email.toLowerCase(),
            passwordHash: 'stored-hash',
          } as unknown as User;
          const usersFound = {
            findByEmailCi: jest.fn().mockResolvedValue(fakeUser),
          } as unknown as UsersService;
          const hasherRejects = {
            verify: jest.fn().mockResolvedValue(false),
          } as unknown as PasswordHasher;
          const serviceBadPassword = new AuthService(
            usersFound,
            hasherRejects,
            tokens,
            lockout,
          );

          const noUserError = await captureError(
            serviceNoUser,
            email,
            password,
          );
          const badPasswordError = await captureError(
            serviceBadPassword,
            email,
            password,
          );

          // Non-disclosure: both branches expose the SAME code and message.
          expect(noUserError.code).toBe('AUTH_FAILED');
          expect(noUserError.message).toBe('Invalid email or password');
          expect(badPasswordError.code).toBe(noUserError.code);
          expect(badPasswordError.message).toBe(noUserError.message);
        },
      ),
      { numRuns: 100 },
    );
  });
});
