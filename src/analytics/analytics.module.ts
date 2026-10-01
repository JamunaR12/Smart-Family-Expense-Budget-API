import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/**
 * Analytics module (Req 11).
 *
 * Wires the monthly and by-category insight endpoints. `PrismaService` (global
 * `PrismaModule`) is available for injection without an explicit import. The
 * global `JwtAuthGuard` protects every route, and the service enforces
 * Data_Isolation via owner-scoped aggregation (Req 3.3, 11.3).
 */
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
