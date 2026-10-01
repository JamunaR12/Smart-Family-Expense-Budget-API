import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  INestApplication,
  Post,
} from '@nestjs/common';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import * as fc from 'fast-check';
import { Public } from '../../src/common/decorators/public.decorator';
import { configureApp } from '../../src/config/configure-app';
import { ERROR_CODES } from '../../src/common/filters/error-codes';

/**
 * // Feature: smart-expense-insights-platform, Property 26
 *
 * Property 26: Validation rejection is total and field-identifying
 * (Req 12.1, 12.2, 12.3, 12.4, 13.4).
 *
 * HTTP-EDGE / NO-DB. This exercises the REAL global `ValidationPipe`
 * (whitelist + forbidNonWhitelisted + the in-envelope `exceptionFactory`) and
 * the REAL `AllExceptionsFilter` as wired by `configureApp()`, driven over
 * Supertest against a tiny `@Public()` probe controller that injects NO
 * database. The controller records whether its handler body was ever reached
 * via a spy that MUST NOT be called when validation fails — proving the request
 * is rejected BEFORE any business logic (so nothing could be persisted).
 *
 * For arbitrary payloads that (a) violate a field constraint, (b) include an
 * unrecognized/extra field, or (c) omit/null a required field, the response is
 * 400, `success === false`, `error.code === 'VALIDATION_ERROR'`, and
 * `error.details` names EACH failing / unrecognized / missing field.
 */

/**
 * A representative DTO with a required string, an optional bounded string, and
 * a bounded integer. `forbidNonWhitelisted` rejects any property not declared
 * here, naming it (Req 12.3).
 */
class ProbeDto {
  @IsNotEmpty({ message: 'name is required' })
  @IsString({ message: 'name must be a string' })
  name!: string;

  @IsInt({ message: 'count must be an integer' })
  @Min(0, { message: 'count must be >= 0' })
  @Max(100, { message: 'count must be <= 100' })
  count!: number;

  @IsOptional()
  @IsString({ message: 'note must be a string' })
  @MaxLength(10, { message: 'note must be at most 10 characters' })
  note?: string;
}

/** Spy that records handler-body entry; asserted to stay false on rejection. */
const handlerSpy = jest.fn();

@Controller({ path: 'probe', version: '1' })
class ProbeController {
  @Public()
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  validate(@Body() dto: ProbeDto): { ok: true } {
    // Reached ONLY when validation passed. On any validation failure the pipe
    // short-circuits before this runs, so the spy proves no business logic ran.
    handlerSpy(dto);
    return { ok: true };
  }
}

describe('Property 26 — validation rejection is total and field-identifying (Req 12.1-12.4, 13.4)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    handlerSpy.mockClear();
  });

  const URL = '/api/v1/probe/validate';

  /** Collects the set of `field` names named in the error envelope details. */
  const fieldsNamed = (body: {
    error?: { details?: { field: string }[] };
  }): Set<string> => new Set((body.error?.details ?? []).map((d) => d.field));

  it('rejects field-constraint violations, naming each failing field, without reaching the handler', async () => {
    // `count` out of range and/or `note` too long: each violation is a named
    // failing field. `name` is kept valid so the ONLY failures come from these.
    const arb = fc.record({
      count: fc.oneof(
        fc.integer({ min: 101, max: 10_000 }), // > Max(100)
        fc.integer({ min: -10_000, max: -1 }), // < Min(0)
      ),
      note: fc.string({ minLength: 11, maxLength: 40 }), // > MaxLength(10)
    });

    await fc.assert(
      fc.asyncProperty(arb, async ({ count, note }) => {
        const res = await request(server)
          .post(URL)
          .send({ name: 'valid', count, note });

        expect(res.status).toBe(HttpStatus.BAD_REQUEST);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);

        const named = fieldsNamed(res.body);
        // Both the out-of-range count and the over-length note are named.
        expect(named.has('count')).toBe(true);
        expect(named.has('note')).toBe(true);
        // The handler body was never reached — no business logic ran.
        expect(handlerSpy).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it('rejects unrecognized/extra fields, naming each of them', async () => {
    // A valid identifier that is NOT one of the declared fields. Building keys
    // as `extra_<n>` guarantees at least one distinct, non-reserved property so
    // the payload always carries a genuine unrecognized field.
    const arb = fc
      .array(fc.integer({ min: 0, max: 999 }), { minLength: 1, maxLength: 4 })
      .map((nums) => Array.from(new Set(nums)).map((n) => `extra_${n}`));

    await fc.assert(
      fc.asyncProperty(arb, async (extraKeys) => {
        const payload: Record<string, unknown> = { name: 'valid', count: 1 };
        for (const k of extraKeys) {
          payload[k] = 'x';
        }

        const res = await request(server).post(URL).send(payload);

        expect(res.status).toBe(HttpStatus.BAD_REQUEST);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);

        const named = fieldsNamed(res.body);
        for (const k of extraKeys) {
          expect(named.has(k)).toBe(true);
        }
        expect(handlerSpy).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it('rejects missing/null required fields, naming each missing field', async () => {
    // Independently drop/null `name` and/or `count`; at least one is missing.
    const presenceArb = fc
      .record({
        includeName: fc.boolean(),
        nameNull: fc.boolean(),
        includeCount: fc.boolean(),
        countNull: fc.boolean(),
      })
      .filter(
        (p) =>
          // Ensure at least one required field is absent or null.
          !p.includeName || p.nameNull || !p.includeCount || p.countNull,
      );

    await fc.assert(
      fc.asyncProperty(presenceArb, async (p) => {
        const payload: Record<string, unknown> = {};
        if (p.includeName) {
          payload.name = p.nameNull ? null : 'valid';
        }
        if (p.includeCount) {
          payload.count = p.countNull ? null : 1;
        }

        const res = await request(server).post(URL).send(payload);

        expect(res.status).toBe(HttpStatus.BAD_REQUEST);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);

        const named = fieldsNamed(res.body);
        const nameMissing = !p.includeName || p.nameNull;
        const countMissing = !p.includeCount || p.countNull;
        if (nameMissing) {
          expect(named.has('name')).toBe(true);
        }
        if (countMissing) {
          expect(named.has('count')).toBe(true);
        }
        // Every rejected request identifies at least one field.
        expect(named.size).toBeGreaterThanOrEqual(1);
        expect(handlerSpy).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it('control: a fully valid payload reaches the handler and returns 200', async () => {
    const res = await request(server)
      .post(URL)
      .send({ name: 'valid', count: 5, note: 'short' });
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.ok).toBe(true);
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });
});
