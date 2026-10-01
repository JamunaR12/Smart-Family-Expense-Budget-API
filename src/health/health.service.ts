import { Injectable } from '@nestjs/common';
import {
  DB_CONNECT_TIMEOUT_MS,
  DatabaseUnavailableException,
  PrismaService,
} from '../prisma/prisma.service';

/** Liveness/readiness report returned on the happy path (Req 16.4). */
export interface HealthReport {
  /** Overall status: `ok` when the app is up and the DB is reachable. */
  status: 'ok';
  /** Database readiness: `up` when the lightweight probe succeeds. */
  db: 'up';
}

/**
 * Health/readiness checks (Req 13.2, 16.4).
 *
 * Liveness is implicit: if this service runs, the application process is up.
 * Readiness performs a lightweight, bounded database probe. The probe uses a
 * parameterless tagged-template `$queryRaw` (`SELECT 1`) — a SAFE query with no
 * string interpolation (no `$queryRawUnsafe`). On failure it surfaces the shared
 * `DatabaseUnavailableException` so the global `AllExceptionsFilter` maps it to a
 * 503 `DB_UNAVAILABLE` envelope, keeping the response consistent and leaking no
 * DB internals (Req 13.2). Persisted data is never touched by the probe.
 */
@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs the readiness check. Returns `{ status: 'ok', db: 'up' }` when the DB
   * responds within the bounded timeout; otherwise throws
   * `DatabaseUnavailableException` (mapped to 503 by the global filter).
   */
  async check(): Promise<HealthReport> {
    await this.probeDatabase();
    return { status: 'ok', db: 'up' };
  }

  /**
   * Executes a bounded `SELECT 1` against the database. Any failure or timeout
   * is normalized to `DatabaseUnavailableException` (`DB_UNAVAILABLE`) so the
   * caller never sees raw driver/DB internals (Req 13.2, 16.4).
   */
  private async probeDatabase(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new DatabaseUnavailableException(
            `Database health probe timed out after ${DB_CONNECT_TIMEOUT_MS}ms`,
          ),
        );
      }, DB_CONNECT_TIMEOUT_MS);
    });

    try {
      // Parameterless tagged template — safe (no interpolation, no Unsafe API).
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
    } catch (error) {
      if (error instanceof DatabaseUnavailableException) {
        throw error;
      }
      // Any other failure (connection dropped, host down) is a DB-unavailability
      // condition from the caller's perspective — do not leak the raw error.
      throw new DatabaseUnavailableException();
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
