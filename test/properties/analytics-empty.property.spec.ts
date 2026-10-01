import { execFileSync } from 'node:child_process';
import { PrismaClient, Prisma } from '@prisma/client';
import * as fc from 'fast-check';
import { AnalyticsService } from '../../src/analytics/analytics.service';
import { windowBoundToDate } from '../../src/budgets/budget-period';
import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * // Feature: smart-expense-insights-platform, Property 4
 *
 * Property 4: Empty analytics yields zero (Req 11.4).
 *
 * DB-GATED. Skipped unless DATABASE_TEST_URL is set. For a user with NO matching
 * expenses — either no expenses at all, or only expenses that fall outside the
 * requested window/range — every returned insight total SHALL be zero and no
 * error SHALL be returned:
 *   - `monthlyTotal` returns `total: '0.00'` (no throw);
 *   - `byCategory` returns `categories: []` (no throw).
 */
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeDb = DATABASE_TEST_URL ? describe : describe.skip;

describeDb('Property 4 (DB) — empty analytics yields zero (Req 11.4)', () => {
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

  // The month/range the user has NO expenses within.
  const MONTH = '2024-03';
  const START = '2024-03-01';
  const END = '2024-03-31';
  // Decoy days strictly OUTSIDE March 2024.
  const outMonthDayArb = fc.oneof(
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

  it('returns zero totals with no error when nothing matches the window/range', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Only out-of-window owner expenses (possibly none at all).
        fc.array(fc.record({ day: outMonthDayArb, amount: amountArb }), {
          minLength: 0,
          maxLength: 8,
        }),
        async (outMonth) => {
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

          for (const e of outMonth) {
            await prisma.expense.create({
              data: {
                userId: owner.id,
                categoryId: cat.id,
                amount: new Prisma.Decimal(e.amount),
                currency: 'USD',
                date: windowBoundToDate(e.day),
              },
            });
          }

          const monthly = await service.monthlyTotal(owner.id, MONTH);
          expect(monthly.month).toBe(MONTH);
          expect(monthly.total).toBe('0.00');

          const byCat = await service.byCategory(owner.id, START, END);
          expect(byCat.startDate).toBe(START);
          expect(byCat.endDate).toBe(END);
          expect(byCat.categories).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
