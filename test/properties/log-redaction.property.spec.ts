import { ExecutionContext, CallHandler } from '@nestjs/common';
import * as fc from 'fast-check';
import { of, firstValueFrom } from 'rxjs';
import type { Request, Response } from 'express';
import { LoggingInterceptor } from '../../src/common/interceptors/logging.interceptor';
import { correlationStorage } from '../../src/common/logging/correlation-context';
import {
  REDACTION_PLACEHOLDER,
  SENSITIVE_KEYS,
  StructuredLogger,
  redact,
} from '../../src/common/logging/logger';

/**
 * // Feature: smart-expense-insights-platform, Property 31
 *
 * Property 31: Secret redaction in logs (Req 14.4, 14.5).
 *
 * PURE / NO-DB. Uses the REAL {@link redact} serializer and the REAL
 * {@link StructuredLogger} / {@link LoggingInterceptor} — nothing is
 * re-implemented. For any object containing sensitive keys (password,
 * authorization, token, secret, jwt, apikey, api_key, cookie — and case/substring
 * variants such as `Authorization`, `accessToken`, `jwtSecret`, `X-Api-Key`) with
 * arbitrary secret string values:
 *  (a) every sensitive value is replaced by {@link REDACTION_PLACEHOLDER};
 *  (b) no raw secret token appears anywhere in `JSON.stringify(redact(obj))`;
 *  (c) non-sensitive values are preserved unchanged;
 *  (d) cyclic structures do not crash (guarded to `[Circular]`).
 *
 * Belt-and-braces: a log entry whose context includes a sensitive key is emitted
 * through the real logger/interceptor and the written line is asserted to carry
 * the placeholder, never the raw secret.
 */
describe('Property 31 — secret redaction in logs (Req 14.4, 14.5)', () => {
  // A recognizable, unique secret token so we can search for its raw presence.
  const secretValue = (): fc.Arbitrary<string> =>
    fc
      .string({ minLength: 1, maxLength: 24 })
      .map((s) => `SECRET_${s.replace(/[^\w]/g, '_')}_END`);

  // A sensitive key name derived from the known list, optionally cased/affixed so
  // substring/case-insensitive matching is exercised (e.g. `Authorization`,
  // `accessToken`, `jwtSecret`, `X-Api-Key`).
  const sensitiveKey = (): fc.Arbitrary<string> =>
    fc
      .tuple(
        fc.constantFrom(...SENSITIVE_KEYS),
        fc.constantFrom('', 'access', 'user', 'x_', 'my'),
        fc.constantFrom('', 'Value', 'Field', '1'),
        fc.boolean(),
      )
      .map(([base, prefix, suffix, upper]) => {
        const key = `${prefix}${base}${suffix}`;
        return upper ? key.toUpperCase() : key;
      });

  // A non-sensitive key that must never collide with a sensitive substring.
  const safeKey = (): fc.Arbitrary<string> =>
    fc.constantFrom(
      'id',
      'method',
      'route',
      'status',
      'count',
      'label',
      'name',
    );

  it('(a)+(b)+(c): every sensitive value redacted, no raw secret in output, safe values preserved', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(sensitiveKey(), secretValue()), {
          minLength: 1,
          maxLength: 5,
        }),
        fc.array(fc.tuple(safeKey(), fc.string({ maxLength: 20 })), {
          minLength: 0,
          maxLength: 5,
        }),
        fc.integer({ min: 0, max: 3 }),
        (sensitivePairs, safePairs, nesting) => {
          // Build a leaf object with both sensitive and safe entries.
          const leaf: Record<string, unknown> = {};
          const secrets: string[] = [];
          const safeEntries: Array<[string, string]> = [];
          for (const [k, v] of sensitivePairs) {
            leaf[k] = v;
            secrets.push(v);
          }
          for (const [k, v] of safePairs) {
            // Avoid overwriting a sensitive key with a safe one.
            if (!(k in leaf)) {
              leaf[k] = v;
              safeEntries.push([k, v]);
            }
          }

          // Optionally wrap the leaf in nested objects (single unique reference
          // per level so there is no shared-reference cycle collapse) and an
          // array sibling so array traversal is also exercised.
          let obj: unknown = leaf;
          for (let i = 0; i < nesting; i += 1) {
            obj = { level: i, siblings: ['a', 'b'], child: obj };
          }

          const result = redact(obj);
          const serialized = JSON.stringify(result);

          // (b) No raw secret token survives anywhere in the serialized output.
          for (const secret of secrets) {
            expect(serialized).not.toContain(secret);
          }
          // The placeholder is present whenever at least one sensitive key exists.
          expect(serialized).toContain(REDACTION_PLACEHOLDER);

          // (a) Drill to the (possibly nested) leaf and assert each sensitive
          // value became the placeholder while (c) safe values are preserved.
          let cursor: Record<string, unknown> = result as Record<
            string,
            unknown
          >;
          for (let i = 0; i < nesting; i += 1) {
            cursor = cursor.child as Record<string, unknown>;
          }
          for (const [k] of sensitivePairs) {
            expect(cursor[k]).toBe(REDACTION_PLACEHOLDER);
          }
          for (const [k, v] of safeEntries) {
            expect(cursor[k]).toBe(v);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('(d): cyclic structures are guarded to [Circular] and do not crash', () => {
    fc.assert(
      fc.property(secretValue(), (secret) => {
        const node: Record<string, unknown> = { token: secret, label: 'ok' };
        node.self = node; // cycle

        let result: unknown;
        expect(() => {
          result = redact(node);
        }).not.toThrow();

        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain(secret);
        expect(serialized).toContain(REDACTION_PLACEHOLDER);
        const out = result as Record<string, unknown>;
        expect(out.token).toBe(REDACTION_PLACEHOLDER);
        expect(out.label).toBe('ok');
        expect(out.self).toBe('[Circular]');
      }),
      { numRuns: 100 },
    );
  });

  describe('belt-and-braces: real logger/interceptor path scrubs sensitive context', () => {
    let stdoutSpy: jest.SpyInstance;
    let stderrSpy: jest.SpyInstance;
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

    it('StructuredLogger writes the placeholder, never the raw secret', () => {
      fc.assert(
        fc.property(secretValue(), sensitiveKey(), (secret, key) => {
          captured = [];
          const logger = new StructuredLogger();
          logger.info('request.completed', { [key]: secret, route: '/x' });

          expect(captured).toHaveLength(1);
          const line = captured[0];
          expect(line).not.toContain(secret);
          expect(line).toContain(REDACTION_PLACEHOLDER);
        }),
        { numRuns: 100 },
      );
    });

    it('LoggingInterceptor scrubs a sensitive field injected into the request path', async () => {
      const interceptor = new LoggingInterceptor();

      await fc.assert(
        fc.asyncProperty(secretValue(), async (secret) => {
          captured = [];
          // Inject a sensitive-looking key onto the request; the interceptor only
          // logs safe metadata, and redact() is the defense-in-depth backstop.
          const request = {
            method: 'GET',
            route: { path: '/api/v1/expenses' },
            originalUrl: '/api/v1/expenses',
            authorization: secret,
            headers: { authorization: secret },
          } as unknown as Request;
          const response = { statusCode: 200 } as unknown as Response;
          const context = {
            switchToHttp: () => ({
              getRequest: <T>() => request as T,
              getResponse: <T>() => response as T,
            }),
          } as unknown as ExecutionContext;
          const next: CallHandler = { handle: () => of({ ok: true }) };

          await correlationStorage.run({ correlationId: 'cid-1' }, async () => {
            await firstValueFrom(interceptor.intercept(context, next));
          });

          expect(captured).toHaveLength(1);
          expect(captured[0]).not.toContain(secret);
        }),
        { numRuns: 100 },
      );
    });
  });
});
