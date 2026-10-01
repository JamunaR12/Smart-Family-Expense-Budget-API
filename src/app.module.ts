import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ExpensesModule } from './expenses/expenses.module';
import { CategoriesModule } from './categories/categories.module';
import { BudgetsModule } from './budgets/budgets.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { HealthModule } from './health/health.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';

/**
 * Coarse rate-limit defaults (task 8.3, design §Security "recommendation").
 *
 * A best-effort, per-container IP throttle: 100 requests per 60s window. This is
 * ONE layer of a layered defense — account-level lockout (Phase 3) guards
 * credential brute-force, this coarse IP throttle blunts request floods, and in
 * production API Gateway throttling provides the authoritative, shared-state
 * limit. On Lambda this in-memory throttler is per-warm-container (imperfect by
 * design), which is exactly why API Gateway throttling is the production
 * recommendation. The limit is deliberately high so normal (and test) traffic is
 * never rejected.
 */
export const THROTTLE_TTL_MS = 60_000;
export const THROTTLE_LIMIT = 100;

/**
 * Root application module.
 *
 * NOTE: This is a Phase 1 wiring. The global config module (Req 15) is imported
 * here so the environment is validated at startup. The correlation-id
 * middleware (Req 14.6) is applied to all routes via `configure()` — middleware
 * registration is conventionally done in `AppModule`, so it lives here rather
 * than in `configureApp()` (task 1.4), which stays focused on pipes/filters/
 * interceptors/guards.
 *
 * The global `PrismaModule` (Phase 2) is imported here so `PrismaService` is
 * available for injection across all feature modules (C3, C6).
 *
 * The `AuthModule` (Phase 3) is imported here; it brings user persistence,
 * registration/login, JWT issuance, lockout, and the passport JWT strategy that
 * backs the globally-registered `JwtAuthGuard` (wired in `configureApp()`).
 *
 * The `ExpensesModule` (Phase 4) is imported here; it brings expense CRUD/list
 * endpoints, all protected by the global `JwtAuthGuard` and owner-scoped for
 * Data_Isolation (Req 3.3, 4-7).
 *
 * The `CategoriesModule` and `BudgetsModule` (Phase 5) are imported here; they
 * bring category CRUD (Req 8) and budget CRUD + status/tracking (Req 9, 10),
 * all protected by the global `JwtAuthGuard` and owner-scoped for
 * Data_Isolation (Req 3.3).
 *
 * The `AnalyticsModule` (Phase 6) is imported here; it brings monthly and
 * by-category spending insights (Req 11), protected by the global
 * `JwtAuthGuard` and owner-scoped for Data_Isolation (Req 3.3, 11.3).
 *
 * The `HealthModule` (Phase 8) is imported here; it brings the public
 * `GET /api/v1/health` liveness/DB-readiness endpoint (Req 16.4).
 *
 * A global `ThrottlerGuard` (Phase 8) applies a coarse per-IP rate limit as a
 * best-effort layer atop account lockout and API Gateway throttling (design
 * §Security recommendation).
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMIT }],
    }),
    AuthModule,
    ExpensesModule,
    CategoriesModule,
    BudgetsModule,
    AnalyticsModule,
    HealthModule,
  ],
  controllers: [],
  providers: [
    // Coarse, best-effort per-IP rate limit (task 8.3). Registered as a global
    // guard; @Public()-ness is unrelated (throttling applies to all routes).
    // The limit is high enough that normal and test traffic is never rejected.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Express 5 (path-to-regexp v8) no longer accepts a bare '*' wildcard;
    // it must be a named wildcard parameter ('*path'). Using the explicit
    // route descriptor form keeps the middleware applied to every route
    // (all methods) without emitting the "Unsupported route path" warning.
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
