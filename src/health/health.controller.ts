import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { HealthReport, HealthService } from './health.service';

/**
 * Health HTTP boundary (Req 16.4).
 *
 * Served at `GET /api/v1/health` and marked `@Public()` so liveness/readiness
 * probes (load balancers, API Gateway, uptime checks) reach it without an
 * Authentication_Token. Delegates to `HealthService`; on DB failure the service
 * throws `DatabaseUnavailableException`, which the global `AllExceptionsFilter`
 * maps to a 503 `DB_UNAVAILABLE` envelope (Req 13.2, 16.4). No DB internals are
 * exposed in either the success or the failure response.
 */
@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Liveness and database readiness',
    description:
      'Public endpoint reporting application liveness and database readiness. ' +
      'Returns 200 { status: "ok", db: "up" } when the app is up and the ' +
      'database responds to a bounded probe. When the database is unreachable ' +
      'within the timeout, returns 503 with the DB_UNAVAILABLE error envelope.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Application is up and the database is reachable.',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        db: { type: 'string', example: 'up' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description:
      'DB_UNAVAILABLE — the database could not be reached within the timeout.',
  })
  check(): Promise<HealthReport> {
    return this.health.check();
  }
}
