import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global Prisma module (design §PrismaModule).
 *
 * Provides and exports the single `PrismaService` so every feature module
 * (Auth, Users, Categories, Expenses, Budgets, Analytics, Health) can inject it
 * without re-importing. `@Global()` + a single provider instance guarantees one
 * cached client per process, reused across warm Lambda invocations (C3, C6).
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
