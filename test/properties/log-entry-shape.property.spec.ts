import { CallHandler, ExecutionContext, HttpException } from '@nestjs/common';
import * as fc from 'fast-check';
import { of, throwError } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import type { NextFunction, Request, Response } from 'express';
import { LoggingInterceptor } from '../../src/common/interceptors/logging.interceptor';
import { CorrelationIdMiddleware } from '../../src/common/middleware/correlation-id.middleware';
import {
  CORRELATION_ID_HEADER,
  correlationStorage,
  getCorrelationId,
} from '../../src/common/logging/correlation-context';
import { LogLevel } from '../../src/common/logging/logger';

/**
 * // Feature: smart-expense-insights-platform, Property 30
 *
 * Property 30: Log entry shape and correlation id (Req 14.1, 14.2, 14.6).
 *
 * PURE / NO-DB. Exercises the REAL {@link LoggingInterceptor} and the REAL
 * {@link CorrelationIdMiddleware} — nothing is re-implemented. For any processed
 * request the emitted structured log entry SHALL contain:
 *  - the request `method`,
 *  - the target `route`,
 *  - the response `status`,
 *  - a non-empty `correlationId` (generated when absent from the request),
 *  - a millisecond-precision ISO `timestamp`,
 *  - and a severity `level` from {DEBUG, INFO, WARN, ERROR}.
 *
 * Approach: the interceptor's `StructuredLogger` writes exactly one JSON line to
 * `process.stdout` (INFO on success) or `process.stderr` (ERROR on failure). We
 * spy on both writers, run `intercept()` with a fake `ExecutionContext` and a
 * fake `CallHandler`, capture the emitted line, parse it, and assert the shape.
 * The interceptor reads the correlation id from `getCorrelationId()`, so the
 * call is wrapped in `correlationStorage.run({ correlationId }, ...)` with a
 * known id.
 *
 * The correlation-id GENERATION path (id created when the client omits the
 * header) is proven directly against `CorrelationIdMiddleware.use()`.
 */
describe('Property 30 — log entry shape and correlation id (Req 14.1, 14.2, 14.6)', () => {
  /** ISO-8601 timestamp with exactly millisecond precision, e.g. 2024-01-15T09:24:00.000Z. */
  const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const LEVELS = new Set<string>(Object.values(LogLevel));

  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;
  /** Lines captured from whichever writer the logger used. */
  let captured: string[];

  beforeEach(() => {
    captured = [];
    const capture = (chunk: unknown): boolean => {
      captured.push(String(chunk));
      return true;
    };
    stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(capture as never);
    stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(capture as never);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  /** Builds a fake ExecutionContext exposing a request (method/route) + response (statusCode). */
  const buildContext = (
    method: string,
    routePath: string,
    statusCode: number,
  ): ExecutionContext => {
    const request = {
      method,
      route: { path: routePath },
      originalUrl: routePath,
      url: routePath,
      headers: {},
    } as unknown as Request;
    const response = { statusCode } as unknown as Response;
    return {
      switchToHttp: () => ({
        getRequest: <T>() => request as T,
        getResponse: <T>() => response as T,
      }),
    } as unknown as ExecutionContext;
  };

  const parseSingleEntry = () => {
    // Exactly one line is emitted per request.
    expect(captured).toHaveLength(1);
    return JSON.parse(captured[0].trim()) as {
      timestamp: string;
      level: string;
      message: string;
      correlationId?: string;
      context?: Record<string, unknown>;
    };
  };

  it('SUCCESS: emits one INFO entry carrying method/route/status/correlationId/ms-timestamp/level', async () => {
    const interceptor = new LoggingInterceptor();

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('GET', 'POST', 'PATCH', 'PUT', 'DELETE'),
        // Route-pattern-like strings (never a raw query string).
        fc
          .array(
            fc.constantFrom(
              'expenses',
              'categories',
              'budgets',
              'analytics',
              ':id',
              'status',
              'monthly',
            ),
            { minLength: 1, maxLength: 4 },
          )
          .map((segs) => `/api/v1/${segs.join('/')}`),
        fc.integer({ min: 200, max: 599 }),
        fc.uuid(),
        async (method, route, status, correlationId) => {
          captured = [];
          const context = buildContext(method, route, status);
          const next: CallHandler = { handle: () => of({ ok: true }) };

          // Run inside a correlation context so getCorrelationId() resolves the id.
          await correlationStorage.run({ correlationId }, async () => {
            await firstValueFrom(interceptor.intercept(context, next));
          });

          const entry = parseSingleEntry();
          const ctx = entry.context ?? {};

          expect(ctx.method).toBe(method);
          expect(ctx.route).toBe(route);
          expect(ctx.status).toBe(status);
          expect(typeof ctx.correlationId).toBe('string');
          expect((ctx.correlationId as string).length).toBeGreaterThan(0);
          expect(ctx.correlationId).toBe(correlationId);
          expect(LEVELS.has(entry.level)).toBe(true);
          expect(entry.level).toBe(LogLevel.INFO);
          expect(ISO_MS.test(entry.timestamp)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('ERROR: emits one ERROR entry (with error category) still carrying the required shape', async () => {
    const interceptor = new LoggingInterceptor();

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('GET', 'POST', 'PATCH', 'DELETE'),
        fc
          .array(fc.constantFrom('expenses', 'budgets', ':id'), {
            minLength: 1,
            maxLength: 3,
          })
          .map((segs) => `/api/v1/${segs.join('/')}`),
        fc.integer({ min: 400, max: 599 }),
        fc.uuid(),
        async (method, route, httpStatus, correlationId) => {
          captured = [];
          const context = buildContext(method, route, 200);
          const error = new HttpException(
            { code: 'VALIDATION_ERROR', message: 'bad' },
            httpStatus,
          );
          // A real observable that errors, so the interceptor's catchError fires.
          const next: CallHandler = {
            handle: () => throwError(() => error),
          };

          // The interceptor re-throws after logging; assert it both logged and threw.
          await expect(
            correlationStorage.run({ correlationId }, async () => {
              await firstValueFrom(interceptor.intercept(context, next));
            }),
          ).rejects.toBe(error);

          const entry = parseSingleEntry();
          const ctx = entry.context ?? {};

          expect(entry.level).toBe(LogLevel.ERROR);
          expect(LEVELS.has(entry.level)).toBe(true);
          expect(ctx.method).toBe(method);
          expect(ctx.route).toBe(route);
          expect(ctx.status).toBe(httpStatus);
          expect(ctx.correlationId).toBe(correlationId);
          // On error the entry carries a non-sensitive error category (Req 14.3).
          expect(typeof ctx.category).toBe('string');
          expect((ctx.category as string).length).toBeGreaterThan(0);
          expect(ISO_MS.test(entry.timestamp)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('GENERATION: middleware creates a non-empty id when the header is absent and shares it downstream', () => {
    const middleware = new CorrelationIdMiddleware();

    fc.assert(
      fc.property(fc.constant(null), () => {
        // No inbound x-correlation-id header.
        const req = { headers: {} } as unknown as Request & {
          correlationId?: string;
        };
        const headers: Record<string, string> = {};
        const res = {
          setHeader: (name: string, value: string) => {
            headers[name] = value;
          },
        } as unknown as Response;

        let seenInsideNext: string | undefined;
        const next: NextFunction = () => {
          // Inside the request lifecycle the stored id must be resolvable.
          seenInsideNext = getCorrelationId();
        };

        middleware.use(req, res, next);

        // A non-empty id is attached to the request and echoed on the response.
        expect(typeof req.correlationId).toBe('string');
        expect((req.correlationId as string).length).toBeGreaterThan(0);
        expect(headers[CORRELATION_ID_HEADER]).toBe(req.correlationId);
        // The same id is visible to downstream handlers via AsyncLocalStorage.
        expect(seenInsideNext).toBe(req.correlationId);
      }),
      { numRuns: 100 },
    );
  });

  it('GENERATION: middleware reuses a non-empty inbound correlation id', () => {
    const middleware = new CorrelationIdMiddleware();

    fc.assert(
      fc.property(fc.uuid(), (inbound) => {
        const req = {
          headers: { [CORRELATION_ID_HEADER]: inbound },
        } as unknown as Request & { correlationId?: string };
        const headers: Record<string, string> = {};
        const res = {
          setHeader: (name: string, value: string) => {
            headers[name] = value;
          },
        } as unknown as Response;

        let seenInsideNext: string | undefined;
        const next: NextFunction = () => {
          seenInsideNext = getCorrelationId();
        };

        middleware.use(req, res, next);

        expect(req.correlationId).toBe(inbound);
        expect(headers[CORRELATION_ID_HEADER]).toBe(inbound);
        expect(seenInsideNext).toBe(inbound);
      }),
      { numRuns: 100 },
    );
  });
});
