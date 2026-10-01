import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  HttpStatus,
  INestApplication,
  NotFoundException,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import * as fc from 'fast-check';
import { Public } from '../../src/common/decorators/public.decorator';
import { configureApp } from '../../src/config/configure-app';
import {
  ERROR_CODES,
  MAX_ERROR_MESSAGE_LENGTH,
} from '../../src/common/filters/error-codes';

/**
 * // Feature: smart-expense-insights-platform, Property 27
 *
 * Property 27: Consistent error envelope and status class (Req 13.1, 13.3).
 *
 * HTTP-EDGE / NO-DB. Drives the REAL `AllExceptionsFilter` (wired by
 * `configureApp()`) over Supertest against `@Public()` probe routes that each
 * throw a different error carrying the in-envelope `{ code, message, details }`
 * shape — plus one route that throws a generic `Error`. For an arbitrary
 * selection among these routes (and arbitrary message lengths, including one
 * that exceeds 500 chars), EVERY response:
 *  - has exactly the identical top-level envelope keys `success/error/meta`;
 *  - carries a machine-readable `code` from the catalog and a `message`
 *    clamped to <= 500 characters;
 *  - uses a 4xx status for client-caused errors and 5xx for server-caused ones
 *    (the generic `Error` -> 500, `ServiceUnavailable` DB_UNAVAILABLE -> 503).
 */

/** The client-caused (4xx) probe cases with their expected code + status. */
interface ClientCase {
  route: string;
  code: string;
  status: number;
}

const CLIENT_CASES: ClientCase[] = [
  { route: 'bad-request', code: ERROR_CODES.VALIDATION_ERROR, status: 400 },
  { route: 'unauthorized', code: ERROR_CODES.AUTH_FAILED, status: 401 },
  { route: 'not-found', code: ERROR_CODES.NOT_FOUND, status: 404 },
  { route: 'conflict', code: ERROR_CODES.CONFLICT, status: 409 },
];

/** The server-caused (5xx) probe cases. */
const SERVER_CASES: { route: string; code: string; status: number }[] = [
  {
    route: 'service-unavailable',
    code: ERROR_CODES.DB_UNAVAILABLE,
    status: 503,
  },
  { route: 'internal', code: ERROR_CODES.INTERNAL_ERROR, status: 500 },
];

@Controller({ path: 'err', version: '1' })
class ErrorProbeController {
  @Public()
  @Get('bad-request')
  badRequest(@Query('len') len?: string): never {
    throw new BadRequestException({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: buildMessage(len),
    });
  }

  @Public()
  @Get('unauthorized')
  unauthorized(@Query('len') len?: string): never {
    throw new UnauthorizedException({
      code: ERROR_CODES.AUTH_FAILED,
      message: buildMessage(len),
    });
  }

  @Public()
  @Get('not-found')
  notFound(@Query('len') len?: string): never {
    throw new NotFoundException({
      code: ERROR_CODES.NOT_FOUND,
      message: buildMessage(len),
    });
  }

  @Public()
  @Get('conflict')
  conflict(@Query('len') len?: string): never {
    throw new ConflictException({
      code: ERROR_CODES.CONFLICT,
      message: buildMessage(len),
    });
  }

  @Public()
  @Get('service-unavailable')
  serviceUnavailable(@Query('len') len?: string): never {
    throw new ServiceUnavailableException({
      code: ERROR_CODES.DB_UNAVAILABLE,
      message: buildMessage(len),
    });
  }

  @Public()
  @Get('internal')
  internal(): never {
    // A generic, non-HttpException error → filter maps it to a generic 500.
    throw new Error('boom: unexpected internal failure');
  }
}

/**
 * Builds a message of the requested length (repeated char), used to exercise
 * the <=500-char clamp when `len` exceeds MAX_ERROR_MESSAGE_LENGTH.
 */
function buildMessage(len?: string): string {
  const n = len ? Number(len) : 12;
  if (!Number.isFinite(n) || n <= 0) {
    return 'error';
  }
  return 'x'.repeat(Math.min(n, 5000));
}

describe('Property 27 — consistent error envelope + status class (Req 13.1, 13.3)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ErrorProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  const CATALOG = new Set(Object.values(ERROR_CODES));

  /** Asserts the body is exactly the consistent envelope shape. */
  const assertEnvelopeShape = (body: unknown): void => {
    expect(typeof body).toBe('object');
    const b = body as Record<string, unknown>;
    // Identical top-level keys across ALL endpoints.
    expect(new Set(Object.keys(b))).toEqual(
      new Set(['success', 'error', 'meta']),
    );
    expect(b.success).toBe(false);
    const error = b.error as Record<string, unknown>;
    expect(typeof error.code).toBe('string');
    expect(typeof error.message).toBe('string');
    expect(CATALOG.has(error.code as never)).toBe(true);
    expect((error.message as string).length).toBeLessThanOrEqual(
      MAX_ERROR_MESSAGE_LENGTH,
    );
    const meta = b.meta as Record<string, unknown>;
    expect('correlationId' in meta).toBe(true);
  };

  it('every client-caused error conforms to the envelope with a 4xx status and catalog code', async () => {
    const arb = fc.record({
      idx: fc.integer({ min: 0, max: CLIENT_CASES.length - 1 }),
      // Include lengths above 500 to exercise the clamp.
      len: fc.integer({ min: 1, max: 1200 }),
    });

    await fc.assert(
      fc.asyncProperty(arb, async ({ idx, len }) => {
        const c = CLIENT_CASES[idx];
        const res = await request(server)
          .get(`/api/v1/err/${c.route}`)
          .query({ len });

        expect(res.status).toBe(c.status);
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
        assertEnvelopeShape(res.body);
        expect(res.body.error.code).toBe(c.code);
      }),
      { numRuns: 100 },
    );
  });

  it('every server-caused error conforms to the envelope with a 5xx status', async () => {
    const arb = fc.integer({ min: 0, max: SERVER_CASES.length - 1 });

    await fc.assert(
      fc.asyncProperty(arb, async (idx) => {
        const c = SERVER_CASES[idx];
        const res = await request(server).get(`/api/v1/err/${c.route}`);

        expect(res.status).toBe(c.status);
        expect(res.status).toBeGreaterThanOrEqual(500);
        expect(res.status).toBeLessThan(600);
        assertEnvelopeShape(res.body);
        expect(res.body.error.code).toBe(c.code);
      }),
      { numRuns: 100 },
    );
  });

  it('clamps an over-length (>500 chars) message to at most 500 characters', async () => {
    const res = await request(server)
      .get('/api/v1/err/bad-request')
      .query({ len: 900 });
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(res.body.error.message.length).toBe(MAX_ERROR_MESSAGE_LENGTH);
  });
});
