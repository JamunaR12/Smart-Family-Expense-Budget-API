import { execFileSync } from 'node:child_process';
import { PrismaClient, Prisma } from '@prisma/client';
import * as fc from 'fast-check';
import { AnalyticsService } from '../../src/analytics/analytics.service';
import { windowBoundToDate } from '../../src/budgets/budget-period';
import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * // Feature: smart-expense-insights-platform, Property 2
 *
 * Property 2: Analytics sum invariant — by category (Req 11.2, 11.5).
 *
 * DB-GATED. Skipped unless DATABASE_TEST_URL is set. For a user with expenses
 * across multiple categories and dates (plus out-of-range and other-user
 * decoys), and an arbitrary inclusive `[startDate, endDate]` range:
 *   - each returned category group total equals the arithmetic sum (Decimal,
 *     tolerance 0.01) of that user's in-range expenses in that category;
 *   - every category that HAS an in-range expense appears in the result;
 *   - no category without an in-range expense appears.
 */
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeDb = DATABASE_TEST_URL ? describe : describe.skip;

describeDb(
  'Property 2 (DB) — by-category sum invariant (Req 11.2, 11.5)',
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

    // The fixed inclusive range under test.
    const START = '2024-03-01';
    const END = '2024-03-31';
    // A day inside the range.
    const inRangeDayArb = fc
      .integer({ min: 1, max: 31 })
      .map((d) => `2024-03-${d.toString().padStart(2, '0')}`);
    // A day outside the range (Feb or April).
    const outRangeDayArb = fc.oneof(
      fc
        .integer({ min: 1, max: 28 })
        .map((d) => `2024-02-${d.toString().padStart(2, '0')}`),
      fc
        .integer({ min: 1, max: 30 })
        .map((d) => `2024-04-${d.toString().padStart(2, '0')}`),
    );
    const amountArb = fc
      .integer({ min: 1, max: 99_999_999 })
      .map((cents) => (cents / 100).toFixed(2));
    // Which of the owner's three categories the expense lands in.
    const catIndexArb = fc.integer({ min: 0, max: 2 });

    it('each group total equals the in-range in-category sum; coverage is exact', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              cat: catIndexArb,
              day: inRangeDayArb,
              amount: amountArb,
            }),
            { minLength: 0, maxLength: 15 },
          ),
          fc.array(
            fc.record({
              cat: catIndexArb,
              day: outRangeDayArb,
              amount: amountArb,
            }),
            { minLength: 0, maxLength: 8 },
          ),
          async (inRange, outRange) => {
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
            const foreignCat = await prisma.category.create({
              data: { userId: other.id, name: 'Foreign', nameCi: 'foreign' },
            });

            // Expected per-category sums from the owner's in-range expenses.
            const expected = new Map<string, Prisma.Decimal>();

            for (const e of inRange) {
              const cat = cats[e.cat];
              await prisma.expense.create({
                data: {
                  userId: owner.id,
                  categoryId: cat.id,
                  amount: new Prisma.Decimal(e.amount),
                  currency: 'USD',
                  date: windowBoundToDate(e.day),
                },
              });
              const prev = expected.get(cat.id) ?? new Prisma.Decimal(0);
              expected.set(cat.id, prev.plus(new Prisma.Decimal(e.amount)));
            }
            // Owner out-of-range expenses (excluded — outside window).
            for (const e of outRange) {
              await prisma.expense.create({
                data: {
                  userId: owner.id,
                  categoryId: cats[e.cat].id,
                  amount: new Prisma.Decimal(e.amount),
                  currency: 'USD',
                  date: windowBoundToDate(e.day),
                },
              });
            }
            // Other user's in-range expense (excluded — foreign owner).
            await prisma.expense.create({
              data: {
                userId: other.id,
                categoryId: foreignCat.id,
                amount: new Prisma.Decimal('999.99'),
                currency: 'USD',
                date: windowBoundToDate('2024-03-15'),
              },
            });

            const result = await service.byCategory(owner.id, START, END);

            expect(result.startDate).toBe(START);
            expect(result.endDate).toBe(END);

            // Coverage: exactly the categories with an in-range expense.
            const returnedIds = new Set(
              result.categories.map((c) => c.categoryId),
            );
            expect(returnedIds).toEqual(new Set(expected.keys()));

            // Each group total equals the arithmetic sum (tolerance 0.01).
            for (const group of result.categories) {
              const want = expected.get(group.categoryId)!;
              expect(
                Math.abs(Number(group.total) - Number(want.toFixed(2))),
              ).toBeLessThanOrEqual(0.01);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  },
);
