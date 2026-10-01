import { HealthService } from '../../src/health/health.service';
import {
  DB_CONNECT_TIMEOUT_MS,
  DB_UNAVAILABLE_CODE,
  DatabaseUnavailableException,
  PrismaService,
} from '../../src/prisma/prisma.service';

/**
 * Unit tests for the HealthService readiness probe (Task 8.3, Req 13.2, 16.4).
 *
 * The probe runs a bounded, parameterless `SELECT 1` via `PrismaService`.
 * A lightweight stub stands in for `PrismaService.$queryRaw` so no live
 * database is required. Fake timers drive the bounded-timeout race
 * deterministically.
 *
 * Covered behavior:
 *  - a reachable DB resolves to `{ status: 'ok', db: 'up' }` (happy path);
 *  - a probe that hangs past the bound rejects with DatabaseUnavailableException
 *    carrying code 'DB_UNAVAILABLE' (Req 16.4);
 *  - a probe query that rejects (connection dropped/host down) is normalized to
 *    DatabaseUnavailableException, leaking no raw DB internals (Req 13.2, 16.4).
 */
describe('HealthService (Req 13.2, 16.4)', () => {
  /** Builds a HealthService with a stubbed `$queryRaw` on a fake PrismaService. */
  function makeService(
    queryRaw: () => Promise<unknown>,
  ): HealthService {
    const prisma = { $queryRaw: jest.fn(queryRaw) } as unknown as PrismaService;
    return new HealthService(prisma);
  }

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns { status: "ok", db: "up" } when the probe succeeds', async () => {
    const service = makeService(() => Promise.resolve([{ '?column?': 1 }]));

    await expect(service.check()).resolves.toEqual({ status: 'ok', db: 'up' });
  });

  it('maps a hung probe past the bound to DB_UNAVAILABLE', async () => {
    jest.useFakeTimers();

    // A $queryRaw that never resolves within the bound.
    const service = makeService(() => new Promise<unknown>(() => undefined));

    const checkPromise = service.check();
    let caught: unknown;
    const settled = checkPromise.catch((error: unknown) => {
      caught = error;
    });

    jest.advanceTimersByTime(DB_CONNECT_TIMEOUT_MS + 1);
    await settled;

    expect(caught).toBeInstanceOf(DatabaseUnavailableException);
    const response = (caught as DatabaseUnavailableException).getResponse();
    expect(response).toMatchObject({ code: DB_UNAVAILABLE_CODE });
  });

  it('normalizes an immediate probe failure to DB_UNAVAILABLE without leaking internals', async () => {
    const service = makeService(() =>
      Promise.reject(new Error('connection terminated unexpectedly')),
    );

    let caught: unknown;
    try {
      await service.check();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DatabaseUnavailableException);
    const response = (caught as DatabaseUnavailableException).getResponse();
    expect(response).toMatchObject({ code: DB_UNAVAILABLE_CODE });
    // The raw driver message must not leak into the surfaced error envelope.
    expect(JSON.stringify(response)).not.toContain('connection terminated');
  });
});
