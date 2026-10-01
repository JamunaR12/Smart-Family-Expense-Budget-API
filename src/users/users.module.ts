import { Module } from '@nestjs/common';
import { UsersService } from './users.service';

/**
 * Users module (Req 1).
 *
 * Provides `UsersService` — the thin user-persistence repository consumed by
 * the Auth module. `PrismaService` is available via the global `PrismaModule`,
 * so no explicit import is needed here.
 */
@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
