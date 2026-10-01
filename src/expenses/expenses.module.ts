import { Module } from '@nestjs/common';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

/**
 * Expenses module (Req 4-7).
 *
 * Wires the expense CRUD/list endpoints. `PrismaService` is available globally
 * (`PrismaModule` is `@Global`) and `AppConfigService` via the global
 * `ConfigModule`, so no explicit imports are needed here. The global
 * `JwtAuthGuard` (registered in `configureApp()`) protects every route, and the
 * service enforces Data_Isolation via owner-scoped queries (Req 3.3).
 */
@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
