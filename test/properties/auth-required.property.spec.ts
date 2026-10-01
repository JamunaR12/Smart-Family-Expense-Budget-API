import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Test } from '@nestjs/testing';
import { Injectable } from '@nestjs/common';
import * as fc from 'fast-check';
import {
  JwtAuthGuard,
  AUTH_REQUIRED_CODE,
} from '../../src/common/guards/jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';

/**
 * Minimal passport `jwt` strategy registered so `AuthGuard('jwt')` has a
 * strategy to invoke. It mirrors the real `JwtStrategy` verification wiring
 * (`ExtractJwt.fromAuthHeaderAsBearerToken`, `ignoreExpiration: false`) but is
 * never expected to succeed here since no valid Bearer token is presented — the
 * point of Property 8 is that a request WITHOUT a token is denied.
 */
@Injectable()
class TestJwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: 'property-8-test-secret',
    });
  }
  validate(payload: { sub: string; email: string }) {
    return { id: payload.sub, email: payload.email };
  }
}

/**
 * // Feature: smart-expense-insights-platform, Property 8
 *
 * Property 8: Authentication required (Req 3.4, 5.9).
 *
 * PURE / NO-DB. Exercises the REAL {@link JwtAuthGuard} (backed by passport-jwt
 * via `AuthGuard('jwt')`) with a real {@link Reflector}. For a NON-public
 * handler with NO `Authorization` header — including arbitrary non-Bearer
 * header values — the guard MUST deny (throws / resolves false), and it must
 * NOT let the request through. A `@Public()` handler is allowed without a token
 * (control).
 *
 * We register a minimal passport `jwt` strategy so `AuthGuard('jwt')` has
 * something to invoke; the strategy is never expected to succeed here because
 * no valid Bearer token is presented.
 */
describe('Property 8 — authentication required (Req 3.4, 5.9)', () => {
  const reflector = new Reflector();
  const guard = new JwtAuthGuard(reflector);

  // Bootstrapping a tiny Nest module registers the passport `jwt` strategy as a
  // side effect, so `AuthGuard('jwt')` can invoke it during canActivate.
  beforeAll(async () => {
    await Test.createTestingModule({ providers: [TestJwtStrategy] }).compile();
  });

  /**
   * Builds a fake ExecutionContext for an HTTP request with the given headers.
   * `isPublic` controls whether the handler is marked `@Public()` so the guard's
   * reflector lookup returns the expected metadata.
   */
  const makeContext = (
    headers: Record<string, string>,
    isPublic: boolean,
  ): ExecutionContext => {
    const publicHandler = () => undefined;
    const nonPublicHandler = () => undefined;
    const handler = isPublic ? publicHandler : nonPublicHandler;

    if (isPublic) {
      // Emulate @Public() metadata that the guard reads via the reflector.
      Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
    }

    const request = { headers };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
        getNext: () => undefined,
      }),
      getHandler: () => handler,
      getClass: () => class TestController {},
      getType: () => 'http',
    } as unknown as ExecutionContext;
  };

  /** Resolves whether the guard ALLOWED the request (true) or DENIED it. */
  const guardAllows = async (context: ExecutionContext): Promise<boolean> => {
    try {
      const result = await guard.canActivate(context);
      // passport can return an Observable/boolean; treat non-true as denial.
      return result === true;
    } catch {
      return false;
    }
  };

  it('denies protected routes for any non-Bearer / missing Authorization header', async () => {
    // Header shapes that are NOT a valid Bearer token: absent, empty, random
    // scheme, or a bare value with no scheme.
    const headerArb = fc.oneof(
      fc.constant<Record<string, string>>({}),
      fc.record({ authorization: fc.constant('') }),
      fc.record({
        authorization: fc
          .string({ minLength: 1, maxLength: 40 })
          .filter((s) => !s.toLowerCase().startsWith('bearer ')),
      }),
    );

    await fc.assert(
      fc.asyncProperty(headerArb, async (headers) => {
        const context = makeContext(headers, false);
        const allowed = await guardAllows(context);
        expect(allowed).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('surfaces AUTH_REQUIRED when no token is present on a protected route', async () => {
    const context = makeContext({}, false);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { code: AUTH_REQUIRED_CODE },
    });
  });

  it('control: allows @Public() handlers without a token', async () => {
    const context = makeContext({}, true);
    await expect(guardAllows(context)).resolves.toBe(true);
  });
});
