import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Bound on how long the initial database connection attempt may take before it
 * is treated as a database-unavailability condition (Req 16.4).
 */
export const DB_CONNECT_TIMEOUT_MS = 10_000;

/** Machine-readable error code surfaced when the database is unreachable. */
export const DB_UNAVAILABLE_CODE = 'DB_UNAVAILABLE';

/**
 * Thrown when the database connection cannot be established within the bounded
 * timeout. Extends NestJS `ServiceUnavailableException` so it maps to a 503 and
 * is picked up by the global `AllExceptionsFilter` with the `DB_UNAVAILABLE`
 * code (Req 16.4). No persisted data is changed by a failed connection attempt.
 */
export class DatabaseUnavailableException extends ServiceUnavailableException {
  constructor(message = 'Database is currently unavailable') {
    super({ code: DB_UNAVAILABLE_CODE, message });
  }
}

/**
 * PrismaClient lifecycle wrapper (design §PostgreSQL + Prisma Design).
 *
 * Registered as a Nest singleton provider (see `PrismaModule`), so the client is
 * instantiated once per process and reused across warm Lambda invocations —
 * `NestFactory.create()`/module init happen once per container, keeping the
 * connection warm and avoiding per-request connection churn (design
 * §Connection management in Lambda; C3, C6).
 *
 * The initial `$connect()` is bounded to `DB_CONNECT_TIMEOUT_MS`; on timeout or
 * connection failure a `DatabaseUnavailableException` (`DB_UNAVAILABLE`) is
 * raised, leaving persisted data unchanged (Req 16.4).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Establishes the database connection at module init, bounded to a 10s
   * timeout. The `DATABASE_URL` is read by PrismaClient from the environment
   * (validated at startup by the config module), so no explicit URL wiring is
   * required here.
   */
  async onModuleInit(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;

    // Race the real connection against a 10s timeout so a stuck/unreachable
    // database surfaces DB_UNAVAILABLE instead of hanging (Req 16.4).
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new DatabaseUnavailableException(
            `Database connection timed out after ${DB_CONNECT_TIMEOUT_MS}ms`,
          ),
        );
      }, DB_CONNECT_TIMEOUT_MS);
    });

    try {
      await Promise.race([this.$connect(), timeout]);
    } catch (error) {
      if (error instanceof DatabaseUnavailableException) {
        this.logger.error(error.message);
        throw error;
      }
      // Any other connection failure (auth, host down, bad URL) is also a
      // database-unavailability condition from the caller's perspective.
      this.logger.error(
        `Failed to connect to the database: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new DatabaseUnavailableException();
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /** Cleanly closes the connection on shutdown (not called between warm Lambda invocations, which is desirable). */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
