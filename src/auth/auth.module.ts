import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/app-config.service';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordHasher } from './password-hasher';
import { TokenService } from './token.service';
import { LockoutService } from './lockout.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { OwnershipGuard } from '../common/guards/ownership.guard';

/**
 * Auth module (Req 1, 2, 3).
 *
 * Wires the auth pipeline: user persistence (`UsersModule`), password hashing,
 * JWT issuance/verification, per-email lockout, and the passport JWT strategy
 * that backs the global `JwtAuthGuard`.
 *
 * `JwtModule` is configured asynchronously from validated configuration so the
 * signing secret and 3600s expiry come from `JWT_SECRET`/`JWT_EXPIRES_IN`
 * (Req 2.4, 15.4). `expiresIn` is set in seconds so every issued token has
 * `exp = iat + JWT_EXPIRES_IN` (Req 2.4).
 *
 * `OwnershipGuard` is exported so the resource modules (Phases 4-6) can apply
 * it to their `/:id` routes; the global `JwtAuthGuard` itself is registered in
 * `configureApp()` (task 3.5).
 */
@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.jwtSecret,
        // expiresIn as a number is interpreted by @nestjs/jwt as seconds, so
        // exp = iat + jwtExpiresIn (default 3600s) exactly (Req 2.4).
        signOptions: { expiresIn: config.jwtExpiresIn },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordHasher,
    TokenService,
    LockoutService,
    JwtStrategy,
    OwnershipGuard,
  ],
  exports: [OwnershipGuard],
})
export class AuthModule {}
