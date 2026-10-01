import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * Health module (Req 16.4).
 *
 * Wires the public `GET /api/v1/health` liveness/readiness endpoint.
 * `PrismaService` (global `PrismaModule`) is injected for the readiness probe
 * without an explicit import. The DB probe runs per-request (never at
 * construction time), so the module graph resolves without a live database.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
