import {
  Controller,
  Get,
  Header,
  HttpStatus,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import * as fc from 'fast-check';
import { Public } from '../../src/common/decorators/public.decorator';
import { configureApp } from '../../src/config/configure-app';
import { ERROR_CODES } from '../../src/common/filters/error-codes';

/**
 * // Feature: smart-expense-insights-platform, Property 28
 *
 * Property 28: Internal-error responses leak no internals (Req 13.2).
 *
 * HTTP-EDGE / NO-DB. Drives the REAL `AllExceptionsFilter` over Supertest
 * against a `@Public()` route that throws a plain `Error` whose message (and
 * synthetic stack) embed distinctive secret-like tokens — a fake DB DSN, a JWT
 * secret, a file path. The filter must map ANY non-HttpException to a GENERIC
 * 500 `INTERNAL_ERROR`, and the FULL serialized response body must NOT contain
 * any of the injected secrets, the DSN, a stack trace, file paths, or any
 * internal detail — only `{ success:false, error:{ code, message }, meta }`
 * with a fixed generic message.
 */

/**
 * The distinctive per-request secret tokens are read from headers so a single
 * probe route can echo arbitrary fast-check-generated secrets into the thrown
 * error WITHOUT them ever appearing in the response.
 */
@Controller({ path: 'leak', version: '1' })
class LeakProbeController {
  @Public()
  @Get('boom')
  @Header('x-noop', '1')
  boom(): never {
    // Read the injected secrets from the incoming request headers via a global
    // (set by the test before each call) — simplest way to parametrize the
    // thrown error's contents per fast-check run.
    const secrets = currentSecrets;
    const error = new Error(
      `internal failure: DSN=${secrets.dsn} JWT_SECRET=${secrets.jwt} ` +
        `token=${secrets.token} at ${secrets.path}`,
    );
    // Overwrite the stack with a synthetic one carrying a file path + secret,
    // to prove the filter never echoes stack contents (Req 13.2).
    error.stack =
      `Error: leak ${secrets.jwt}\n` +
      `    at LeakProbeController.boom (${secrets.path}:42:7)\n` +
      `    at ${secrets.dsn}`;
    throw error;
  }
}

/** Per-run secrets, set by the property body before each request. */
let currentSecrets = { dsn: '', jwt: '', token: '', path: '' };

describe('Property 28 — internal-error responses leak no internals (Req 13.2)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LeakProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a generic 500 INTERNAL_ERROR whose body contains none of the secrets/stack/path', async () => {
    const secretArb = fc.record({
      dsn: fc
        .string({ minLength: 4, maxLength: 20 })
        .map((s) => `postgres://user:${s}@db-host:5432/app`),
      jwt: fc
        .string({ minLength: 8, maxLength: 32 })
        .map((s) => `SUPERSECRET_${s}`),
      token: fc.uuid().map((u) => `Bearer_${u}`),
      path: fc.constant('/srv/app/src/leak/probe.controller.ts'),
    });

    await fc.assert(
      fc.asyncProperty(secretArb, async (secrets) => {
        currentSecrets = secrets;

        const res = await request(server).get('/api/v1/leak/boom');

        // Generic 500 with the INTERNAL_ERROR code (Req 13.2).
        expect(res.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);

        // Body shape is exactly the generic envelope — no `details`, no extras.
        expect(new Set(Object.keys(res.body))).toEqual(
          new Set(['success', 'error', 'meta']),
        );
        expect(new Set(Object.keys(res.body.error))).toEqual(
          new Set(['code', 'message']),
        );

        // The FULL serialized response must not contain any secret/internal.
        const serialized = JSON.stringify(res.body);
        expect(serialized).not.toContain(secrets.dsn);
        expect(serialized).not.toContain(secrets.jwt);
        expect(serialized).not.toContain(secrets.token);
        expect(serialized).not.toContain(secrets.path);
        expect(serialized).not.toContain('SUPERSECRET_');
        expect(serialized).not.toContain('postgres://');
        expect(serialized.toLowerCase()).not.toContain('stack');
        expect(serialized).not.toContain('.ts:');
        expect(serialized).not.toContain('at LeakProbeController');
      }),
      { numRuns: 100 },
    );
  });
});
