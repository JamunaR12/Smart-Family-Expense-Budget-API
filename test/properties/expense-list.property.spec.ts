import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import * as fc from 'fast-check';
import { ListExpensesQueryDto } from '../../src/expenses/dto/list-expenses-query.dto';
import { ExpensesService } from '../../src/expenses/expenses.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { AppConfigService } from '../../src/config/app-config.service';

/**
 * // Feature: smart-expense-insights-platform, Property 20
 *
 * Property 20: Expense list filtering, ordering, and pagination
 * (Req 5.2, 5.3, 5.4, 5.5).
 *
 * DB-GATED. Skipped unless DATABASE_TEST_URL is set. Seeds one owner with a
 * random set of expenses across dates and categories (plus a second user whose
 * rows must never appear), then for arbitrary valid filter + pagination combos
 * asserts the result:
 *  - contains ONLY the owner's rows matching every applied filter;
 *  - is ordered by date descending;
 *  - has length <= the requested limit and corresponds to the requested offset
 *    slice of the full filtered set;
 *  - treats date-range boundaries as inclusive.
 */
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeDb = DATABASE_TEST_URL ? describe : describe.skip;

/** Local mirror of a seeded expense used to compute the expected result set. */
interface SeededExpense {
  id: string;
  categoryId: string;
  date: string; // YYYY-MM-DD
  createdAt: number; // ms, monotonically increasing tiebreaker
}

describeDb(
  'Property 20 (DB) — list filter/order/pagination (Req 5.2-5.5)',
  () => {
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

    // A calendar day in a small fixed window (keeps ranges meaningful).
    const dayArb = fc
      .integer({ min: 1, max: 28 })
      .map((d) => `2024-03-${d.toString().padStart(2, '0')}`);

    it('returns only matching owner rows, date-desc, sliced by limit/offset, inclusive bounds', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({ day: dayArb, cat: fc.integer({ min: 0, max: 2 }) }),
            {
              minLength: 0,
              maxLength: 12,
            },
          ),
          fc.option(dayArb, { nil: undefined }),
          fc.option(dayArb, { nil: undefined }),
          fc.option(fc.integer({ min: 0, max: 2 }), { nil: undefined }),
          fc.integer({ min: 1, max: 100 }),
          fc.integer({ min: 0, max: 15 }),
          async (rows, startDay, endDay, catIndex, limit, offset) => {
            // Fresh slate each run.
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
            const other = await prisma.user.create({
              data: {
                email: 'Other@Example.com',
                emailCi: 'other@example.com',
                passwordHash: 'hash',
              },
            });

            // Three categories for the owner, one for the other user.
            const cats = await Promise.all(
              [0, 1, 2].map((i) =>
                prisma.category.create({
                  data: {
                    userId: owner.id,
                    name: `Cat${i}`,
                    nameCi: `cat${i}`,
                  },
                }),
              ),
            );
            const otherCat = await prisma.category.create({
              data: { userId: other.id, name: 'Other', nameCi: 'other' },
            });

            // Seed the owner's expenses, tracking each for the expected set.
            const seeded: SeededExpense[] = [];
            let tick = 0;
            for (const row of rows) {
              const created = await prisma.expense.create({
                data: {
                  userId: owner.id,
                  categoryId: cats[row.cat].id,
                  amount: '1.00',
                  currency: 'USD',
                  date: new Date(`${row.day}T00:00:00.000Z`),
                },
              });
              seeded.push({
                id: created.id,
                categoryId: created.categoryId,
                date: row.day,
                createdAt: tick++,
              });
            }

            // A decoy for the other user that must NEVER appear.
            await prisma.expense.create({
              data: {
                userId: other.id,
                categoryId: otherCat.id,
                amount: '99.00',
                currency: 'USD',
                date: new Date('2024-03-15T00:00:00.000Z'),
              },
            });

            const startDate = startDay;
            const endDate =
              startDay && endDay && endDay < startDay ? startDay : endDay;
            const categoryId =
              catIndex !== undefined ? cats[catIndex].id : undefined;

            const query = plainToInstance(ListExpensesQueryDto, {
              ...(startDate ? { startDate } : {}),
              ...(endDate ? { endDate } : {}),
              ...(categoryId ? { categoryId } : {}),
              limit,
              offset,
            });

            const result = await service.findMany(owner.id, query);

            // Expected filtered set computed locally with the same rules.
            const expected = seeded
              .filter((e) => (startDate ? e.date >= startDate : true))
              .filter((e) => (endDate ? e.date <= endDate : true))
              .filter((e) => (categoryId ? e.categoryId === categoryId : true))
              // date desc, then createdAt desc (stable tiebreaker).
              .sort((a, b) =>
                a.date === b.date
                  ? b.createdAt - a.createdAt
                  : a.date < b.date
                    ? 1
                    : -1,
              );

            const expectedPage = expected.slice(offset, offset + limit);

            // Total reflects the full filtered set, independent of the page.
            expect(result.meta.pagination.total).toBe(expected.length);
            expect(result.meta.pagination.limit).toBe(limit);
            expect(result.meta.pagination.offset).toBe(offset);

            // Page length never exceeds the requested limit.
            expect(result.data.length).toBeLessThanOrEqual(limit);
            expect(result.data.length).toBe(expectedPage.length);

            // Only owner rows, matching every filter.
            for (const item of result.data) {
              const src = seeded.find((s) => s.id === item.id);
              expect(src).toBeDefined();
              if (startDate) expect(item.date >= startDate).toBe(true);
              if (endDate) expect(item.date <= endDate).toBe(true);
              if (categoryId) expect(item.categoryId).toBe(categoryId);
            }

            // Ordered by date descending across the page.
            for (let i = 1; i < result.data.length; i++) {
              expect(result.data[i - 1].date >= result.data[i].date).toBe(true);
            }

            // The page corresponds to the expected offset slice (by date/category;
            // ids sharing a date+category are interchangeable under the tiebreaker).
            expect(result.data.map((d) => d.date)).toEqual(
              expectedPage.map((e) => e.date),
            );
          },
        ),
        { numRuns: 100 },
      );
    });
  },
);
