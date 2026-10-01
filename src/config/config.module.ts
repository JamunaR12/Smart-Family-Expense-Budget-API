import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import { validateEnv } from './env.validation';

/**
 * Global configuration module.
 *
 * Wraps `@nestjs/config` so that the environment is validated with `validateEnv`
 * BEFORE the application accepts requests (Req 15.1). On any missing/empty/
 * whitespace/type-invalid value, `validateEnv` throws and startup fails fast
 * (Req 15.2, 15.3, 15.5).
 *
 * Exposes the typed `AppConfigService` so downstream modules read strongly-typed
 * configuration and secrets are never hardcoded (Req 15.4).
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class ConfigModule {}
