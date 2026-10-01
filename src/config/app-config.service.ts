import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from './env.validation';

/**
 * Typed accessor over the validated environment configuration.
 *
 * Downstream modules inject `AppConfigService` and read strongly-typed values
 * rather than reaching into `process.env` or an untyped `ConfigService`.
 * Because `ConfigModule.forRoot({ validate })` runs `validateEnv` at startup,
 * every value read here is guaranteed present, typed, and defaulted (Req 15.1).
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  /** Strongly-typed getter for any validated configuration key. */
  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.configService.get(key, { infer: true }) as AppConfig[K];
  }

  get runtimeEnv(): AppConfig['RUNTIME_ENV'] {
    return this.get('RUNTIME_ENV');
  }

  get port(): number {
    return this.get('PORT');
  }

  get databaseUrl(): string {
    return this.get('DATABASE_URL');
  }

  get jwtSecret(): string {
    return this.get('JWT_SECRET');
  }

  get jwtExpiresIn(): number {
    return this.get('JWT_EXPIRES_IN');
  }

  get platformTimezone(): string {
    return this.get('PLATFORM_TIMEZONE');
  }

  get logLevel(): AppConfig['LOG_LEVEL'] {
    return this.get('LOG_LEVEL');
  }

  get loginMaxAttempts(): number {
    return this.get('LOGIN_MAX_ATTEMPTS');
  }

  get loginWindowMinutes(): number {
    return this.get('LOGIN_WINDOW_MINUTES');
  }

  get loginLockoutSeconds(): number {
    return this.get('LOGIN_LOCKOUT_SECONDS');
  }

  /**
   * Optional raw `CORS_ORIGINS` value (comma-separated allowed origins), or
   * `undefined` when unset. Parsing into a list and the safe default (disable
   * cross-origin when unset — never `'*'`) are applied in `configureApp()`.
   */
  get corsOrigins(): string | undefined {
    return this.get('CORS_ORIGINS');
  }
}
