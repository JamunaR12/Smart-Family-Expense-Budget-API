import { execFileSync } from 'node:child_process';
import { PrismaClient, Prisma } from '@prisma/client';
import * as fc from 'fast-check';
import { AnalyticsService } from '../../src/analytics/analytics.service';
import { monthWindow } from '../../src/analytics/month-window';
import { windowBoundToDate } from '../../src/budgets/budget-period';
import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * // Feature: smart-expense-insights-platform, Property 1
 *
 * Property 1: Analytics sum invariant — monthly (Req 11.1, 11.5, 17.5).
 *
 * This file is split into a PURE part (always runs) and a DB-GATED part
 * (skipped without DATABASE_TEST_URL):
 *
 *  - PURE: `monthWindow` is deterministic, so its window invariants are
 *    asserted directly for arbitrary `YYYY-MM` months — start = the first day
 *    of the month, end = the last day (leap-aware), start <= end. These are the
 *    window bounds the monthly SUM aggregation filters on, so they underpin the
 *    monthly sum invariant.
 *  - DB-GATED: for a user with an arbitrary set of expenses (some inside a
 *    chosen month, some outside, plus another user's expenses as decoys),
 *    `monthlyTotal(userId, month).total` equals the arithmetic sum of that
 *    user's own in-month amounts to a tolerance of 0.01.
 */

// ---------------------------------------------------------------------------
// PURE — monthWindow bounds (always runs, no database).
// ---------------------------------------------------------------------------
describe('Property 1 (pure) — monthWindow bounds (Req 11.1)', () => {
  const monthArb = fc
    .record({
      year: fc.integer({ min: 1970, max: 2100 }),
      month: fc.integer({ min: 1, max: 12 }),
    })
    .map(
      ({ year, month }) =>
        `${year.toString().padStart(4, '0')}-${month
          .toString()
          .padStart(2, '0')}`,
    );

  it('start is the first day and end is the last day of the month (leap-aware)', () => {
    fc.assert(
      fc.property(monthArb, (month) => {
        const [year, m] = month.split('-').map((p) => Number(p));
        const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
        const w = monthWindow(month);
        expect(w.start).toBe(`${month}-01`);
        expect(w.end).toBe(`${month}-${lastDay.toString().padStart(2, '0')}`);
        expect(w.start <= w.end).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('sampled month lengths: Feb 2024 -> 29, Feb 2023 -> 28, Apr -> 30, Jan -> 31', () => {
    expect(monthWindow('2024-02').end).toBe('2024-02-29');
    expect(monthWindow('2023-02').end).toBe('2023-02-28');
    expect(monthWindow('2024-04').end).toBe('2024-04-30');
    expect(monthWindow('2024-01').end).toBe('2024-01-31');
  });
});

// ---------------------------------------------------------------------------
// DB-GATED — monthlyTotal over seeded expenses (skipped without a DB).
// ---------------------------------------------------------------------------
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeDb = DATABASE_TEST_URL ? describe : describe.skip;

describeDb(
  'Property 1 (DB) — monthly sum invariant (Req 11.1, 11.5, 17.5)',
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

    // The fixed month under test.
    const MONTH = '2024-03';
    // A day inside March 2024.
    const inMonthDayArb = fc
      .integer({ min: 1, max: 31 })
      .map((d) => `2024-03-${d.toString().padStart(2, '0')}`);
    // A day outside March 2024 (Feb or April).
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

    it('total equals the arithmetic sum of the owner in-month amounts (tolerance 0.01)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.record({ day: inMonthDayArb, amount: amountArb }), {
            minLength: 0,
            maxLength: 12,
          }),
          fc.array(fc.record({ day: outMonthDayArb, amount: amountArb }), {
            minLength: 0,
            maxLength: 6,
          }),
          async (inMonth, outMonth) => {
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
            const cat = await prisma.category.create({
              data: { userId: owner.id, name: 'Food', nameCi: 'food' },
            });
            const foreignCat = await prisma.category.create({
              data: { userId: other.id, name: 'Foreign', nameCi: 'foreign' },
            });

            // Owner in-month expenses (SHOULD be counted).
            for (const e of inMonth) {
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
            // Owner out-of-month expenses (excluded — outside window).
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
            // Other user's in-month expense (excluded — foreign owner).
            await prisma.expense.create({
              data: {
                userId: other.id,
                categoryId: foreignCat.id,
                amount: new Prisma.Decimal('123.45'),
                currency: 'USD',
                date: windowBoundToDate('2024-03-10'),
              },
            });

            const expected = inMonth.reduce(
              (acc, e) => acc.plus(new Prisma.Decimal(e.amount)),
              new Prisma.Decimal(0),
            );

            const result = await service.monthlyTotal(owner.id, MONTH);

            expect(result.month).toBe(MONTH);
            expect(
              Math.abs(Number(result.total) - Number(expected.toFixed(2))),
            ).toBeLessThanOrEqual(0.01);

            if (inMonth.length === 0) {
              expect(result.total).toBe('0.00');
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  },
);
