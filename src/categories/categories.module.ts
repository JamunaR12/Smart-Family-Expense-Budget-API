import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

/**
 * Categories module (Req 8).
 *
 * Wires the category CRUD endpoints. `PrismaService` is available globally
 * (`PrismaModule` is `@Global`), so no explicit imports are needed here. The
 * global `JwtAuthGuard` (registered in `configureApp()`) protects every route,
 * and the service enforces Data_Isolation via owner-scoped queries (Req 3.3).
 * `CategoriesService` is exported so later modules (e.g. Budgets) can reuse
 * category-ownership logic if needed.
 */
@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
