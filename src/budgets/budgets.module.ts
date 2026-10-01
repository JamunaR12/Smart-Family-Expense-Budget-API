import { Module } from '@nestjs/common';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';

/**
 * Budgets module (Req 9, 10).
 *
 * Wires the budget CRUD/status endpoints. `PrismaService` (global
 * `PrismaModule`) and `AppConfigService` (global `ConfigModule`) are available
 * for injection without explicit imports. The global `JwtAuthGuard` protects
 * every route, and the service enforces Data_Isolation via owner-scoped
 * queries (Req 3.3).
 */
@Module({
  controllers: [BudgetsController],
  providers: [BudgetsService],
  exports: [BudgetsService],
})
export class BudgetsModule {}
