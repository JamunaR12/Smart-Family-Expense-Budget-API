import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import * as fc from 'fast-check';
import { ExpensesService } from '../../src/expenses/expenses.service';
import { NOT_FOUND_CODE } from '../../src/common/guards/ownership.guard';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { AppConfigService } from '../../src/config/app-config.service';

/**
 * // Feature: smart-expense-insights-platform, Property 18
 *
 * Property 18: Expense deletion round-trip (Req 7.1).
 *
 * DB-GATED. Skipped unless DATABASE_TEST_URL is set. For an owned expense,
 * deleting it returns a confirmation and a subsequent read as the owner yields
 * the non-disclosing not-found result (404 NOT_FOUND).
 */
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeDb = DATABASE_TEST_URL ? describe : describe.skip;

describeDb('Property 18 (DB) — delete round-trip (Req 7.1)', () => {
  let prisma: PrismaClient;
  let service: ExpensesService;
  const config = { platformTimezone: 'UTC' } as unknown as AppConfigService;

  beforeAll(async () => {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: DATABASE_TEST_URL },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    prisma = new PrismaClient({
      datasources: { db: { url: DATABASE_TEST_URL } },
    });
    await prisma.$connect();
    service = new ExpensesService(prisma as unknown as PrismaService, config);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    await prisma.budget.deleteMany();
    await prisma.expense.deleteMany();
    await prisma.category.deleteMany();
    await prisma.user.deleteMany();
    await prisma.loginAttempt.deleteMany();
  });

  const dateArb = fc
    .date({
      min: new Date(Date.UTC(2000, 0, 1)),
      max: new Date(Date.UTC(2020, 11, 31)),
      noInvalidDate: true,
    })
    .map((d) => d.toISOString().slice(0, 10));

  it('deleting an owned expense then reading it yields not-found', async () => {
    await fc.assert(
      fc.asyncProperty(dateArb, async (date) => {
        await prisma.expense.deleteMany();
        await prisma.category.deleteMany();
        await prisma.user.deleteMany();

        const owner = await prisma.user.create({
          data: {
            email: 'Owner@Example.com',
            emailCi: 'owner@example.com',
            passwordHash: 'hash',
          },
        });
        const category = await prisma.category.create({
          data: { userId: owner.id, name: 'Food', nameCi: 'food' },
        });
        const created = await service.create(owner.id, {
          amount: '12.34',
          currency: 'USD',
          date,
          categoryId: category.id,
        });

        const confirmation = await service.remove(owner.id, created.id);
        expect(confirmation).toEqual({ deleted: true, id: created.id });

        await expect(
          service.findOne(owner.id, created.id),
        ).rejects.toMatchObject({ response: { code: NOT_FOUND_CODE } });
      }),
      { numRuns: 100 },
    );
  });
});
