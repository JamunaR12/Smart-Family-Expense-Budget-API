import { execFileSync } from 'node:child_process';
import { PrismaClient, Prisma } from '@prisma/client';
import * as fc from 'fast-check';
import { AnalyticsService } from '../../src/analytics/analytics.service';
import { windowBoundToDate } from '../../src/budgets/budget-period';
import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * // Feature: smart-expense-insights-platform, Property 3
 *
 * Property 3: Deletion excludes from analytics (Req 7.4, 11.5).
 *
 * DB-GATED. Skipped unless DATABASE_TEST_URL is set. For a user with a set of
 * in-month expenses, deleting a single expense SHALL decrease every subsequently
 * computed insight total that previously included it by exactly that expense's
 * amount (tolerance 0.01):
 *   - the monthly total drops by the deleted amount;
 *   - the by-category total for the deleted expense's category drops likewise.
 * A deleted expense is simply no longer a row, so it is excluded naturally.
 */
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeDb = DATABASE_TEST_URL ? describe : describe.skip;

describeDb(
  'Property 3 (DB) — deletion excludes from analytics (Req 7.4, 11.5)',
  () => {
    let prisma: PrismaClient;
    let service: AnalyticsService;

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
      service = new AnalyticsService(prisma as unknown as PrismaService);
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

    const MONTH = '2024-03';
    const START = '2024-03-01';
    const END = '2024-03-31';
    const inMonthDayArb = fc
      .integer({ min: 1, max: 31 })
      .map((d) => `2024-03-${d.toString().padStart(2, '0')}`);
    const amountArb = fc
      .integer({ min: 1, max: 99_999_999 })
      .map((cents) => (cents / 100).toFixed(2));

    it('deleting one expense drops monthly and by-category totals by exactly its amount', async () => {
      await fc.assert(
        fc.asyncProperty(
          // At least one expense so there is something to delete.
          fc.array(fc.record({ day: inMonthDayArb, amount: amountArb }), {
            minLength: 1,
            maxLength: 12,
          }),
          async (expenses) => {
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
            const cat = await prisma.category.create({
              data: { userId: owner.id, name: 'Food', nameCi: 'food' },
            });

            const created: { id: string; amount: string }[] = [];
            for (const e of expenses) {
              const row = await prisma.expense.create({
                data: {
                  userId: owner.id,
                  categoryId: cat.id,
                  amount: new Prisma.Decimal(e.amount),
                  currency: 'USD',
                  date: windowBoundToDate(e.day),
                },
              });
              created.push({ id: row.id, amount: e.amount });
            }

            const beforeMonthly = await service.monthlyTotal(owner.id, MONTH);
            const beforeByCat = await service.byCategory(owner.id, START, END);
            const beforeCatTotal = beforeByCat.categories.find(
              (c) => c.categoryId === cat.id,
            )!.total;

            // Delete the first expense.
            const victim = created[0];
            await prisma.expense.delete({ where: { id: victim.id } });

            const afterMonthly = await service.monthlyTotal(owner.id, MONTH);
            const afterByCat = await service.byCategory(owner.id, START, END);
            const afterCat = afterByCat.categories.find(
              (c) => c.categoryId === cat.id,
            );
            const afterCatTotal = afterCat ? afterCat.total : '0.00';

            const droppedMonthly =
              Number(beforeMonthly.total) - Number(afterMonthly.total);
            const droppedCat = Number(beforeCatTotal) - Number(afterCatTotal);

            expect(
              Math.abs(droppedMonthly - Number(victim.amount)),
            ).toBeLessThanOrEqual(0.01);
            expect(
              Math.abs(droppedCat - Number(victim.amount)),
            ).toBeLessThanOrEqual(0.01);
          },
        ),
        { numRuns: 100 },
      );
    });
  },
);
