import {
  DB_CONNECT_TIMEOUT_MS,
  DB_UNAVAILABLE_CODE,
  DatabaseUnavailableException,
  PrismaService,
} from '../../src/prisma/prisma.service';

/**
 * Unit tests for the PrismaService lifecycle wrapper (Task 2.4, Req 16.4).
 *
 * These tests exercise the connect-timeout → DB_UNAVAILABLE mapping WITHOUT a
 * live database. `$connect`/`$disconnect` (inherited from PrismaClient) are
 * replaced with jest spies on the instance, so no real connection is ever
 * attempted. Fake timers drive the 10s timeout race deterministically.
 *
 * Covered behavior:
 *  - a $connect that hangs past DB_CONNECT_TIMEOUT_MS rejects onModuleInit with
 *    DatabaseUnavailableException carrying code 'DB_UNAVAILABLE' (Req 16.4);
 *  - a $connect that rejects immediately with a generic error is surfaced as a
 *    DatabaseUnavailableException (Req 16.4);
 *  - a successful $connect resolves onModuleInit without throwing;
 *  - onModuleDestroy delegates to $disconnect.
 */
describe('PrismaService (Req 16.4)', () => {
  let service: PrismaService;

  beforeEach(() => {
    service = new PrismaService();
    // Never touch a real database: stub the client lifecycle methods.
    jest
      .spyOn(
        service as unknown as { $disconnect: () => Promise<void> },
        '$disconnect',
      )
      .mockResolvedValue(undefined);
    // Silence the service's internal error logging during these tests.
    const withLogger = service as unknown as {
      logger: { error: (m: string) => void };
    };
    jest.spyOn(withLogger.logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('exports the documented timeout bound and error code', () => {
    expect(DB_CONNECT_TIMEOUT_MS).toBe(10_000);
    expect(DB_UNAVAILABLE_CODE).toBe('DB_UNAVAILABLE');
  });

  it('maps a hung connection past the 10s bound to DB_UNAVAILABLE', async () => {
    jest.useFakeTimers();

    // A $connect that never resolves within the bound.
    const connectSpy = jest
      .spyOn(
        service as unknown as { $connect: () => Promise<void> },
        '$connect',
      )
      .mockImplementation(() => new Promise<void>(() => undefined));

    // Capture the rejection reason so we can assert both its type and the
    // machine-readable code it carries.
    const initPromise = service.onModuleInit();
    let caught: unknown;
    const settled = initPromise.catch((error: unknown) => {
      caught = error;
    });

    // Advance past the 10s connect bound to trip the timeout branch.
    jest.advanceTimersByTime(DB_CONNECT_TIMEOUT_MS + 1);
    await settled;

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(caught).toBeInstanceOf(DatabaseUnavailableException);
    const response = (caught as DatabaseUnavailableException).getResponse();
    expect(response).toMatchObject({ code: DB_UNAVAILABLE_CODE });
  });

  it('maps an immediate generic connect failure to DB_UNAVAILABLE', async () => {
    // A $connect that rejects right away (auth error, host down, bad URL).
    jest
      .spyOn(
        service as unknown as { $connect: () => Promise<void> },
        '$connect',
      )
      .mockRejectedValue(new Error('ECONNREFUSED'));

    let caught: unknown;
    try {
      await service.onModuleInit();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DatabaseUnavailableException);
    const response = (caught as DatabaseUnavailableException).getResponse();
    expect(response).toMatchObject({ code: DB_UNAVAILABLE_CODE });
  });

  it('resolves onModuleInit without throwing when connect succeeds', async () => {
    jest.useFakeTimers();

    jest
      .spyOn(
        service as unknown as { $connect: () => Promise<void> },
        '$connect',
      )
      .mockResolvedValue(undefined);

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    // No timer should remain pending after a successful connect (the timeout
    // handle is cleared in the finally block) — advancing time is a no-op and
    // must not produce a late rejection.
    jest.advanceTimersByTime(DB_CONNECT_TIMEOUT_MS + 1);
  });

  it('delegates onModuleDestroy to $disconnect', async () => {
    const disconnectSpy = jest.spyOn(
      service as unknown as { $disconnect: () => Promise<void> },
      '$disconnect',
    );

    await service.onModuleDestroy();

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});
