import { execFileSync } from 'node:child_process';
import { PrismaClient, Prisma } from '@prisma/client';
import * as fc from 'fast-check';
import {
  computePeriodWindow,
  windowBoundToDate,
} from '../../src/budgets/budget-period';
import { BudgetsService } from '../../src/budgets/budgets.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { AppConfigService } from '../../src/config/app-config.service';

/**
 * // Feature: smart-expense-insights-platform, Property 25
 *
 * Property 25: Budget status computation (Req 10.1, 10.2, 10.3, 10.5).
 *
 * This file is split into a PURE part (always runs) and a DB-GATED part
 * (skipped without DATABASE_TEST_URL):
 *
 *  - PURE: `computePeriodWindow` is deterministic, so its window invariants
 *    are asserted directly for arbitrary reference dates + each period —
 *    monthly = first..last day of the reference month (leap-aware), yearly =
 *    Jan 1..Dec 31, weekly = a Monday..the following Sunday spanning exactly 7
 *    days and containing the reference day; start <= end lexicographically.
 *  - DB-GATED: for a budget and an arbitrary set of the user's in-scope,
 *    in-period expenses (plus out-of-window, other-category, and other-user
 *    decoys that must be excluded), `getStatus` reports total = arithmetic sum
 *    of the in-scope in-period amounts (tolerance 0.01), remaining =
 *    limit - total, within_limit when total <= limit (remaining >= 0) else
 *    exceeded with exceeded = total - limit; zero in-scope expenses → total
 *    '0.00', remaining = limit, within_limit. A fixed reference `now` makes the
 *    window deterministic.
 */

// ---------------------------------------------------------------------------
// PURE — computePeriodWindow window invariants (always runs, no database).
// ---------------------------------------------------------------------------
describe('Property 25 (pure) — computePeriodWindow invariants (Req 10.1)', () => {
  const TZ = 'UTC';
  const referenceArb = fc
    .date({
      min: new Date(Date.UTC(2000, 0, 1)),
      max: new Date(Date.UTC(2035, 11, 31)),
      noInvalidDate: true,
    })
    // Evaluate at UTC midnight so the reference day is unambiguous under UTC.
    .map(
      (d) =>
        new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())),
    );

  const refYmd = (d: Date): string =>
    `${d.getUTCFullYear().toString().padStart(4, '0')}-${(d.getUTCMonth() + 1)
      .toString()
      .padStart(2, '0')}-${d.getUTCDate().toString().padStart(2, '0')}`;

  const daysBetweenInclusive = (start: string, end: string): number => {
    const s = windowBoundToDate(start).getTime();
    const e = windowBoundToDate(end).getTime();
    return Math.round((e - s) / (24 * 60 * 60 * 1000)) + 1;
  };

  it('monthly window is the first..last day of the reference month (leap-aware)', async () => {
    fc.assert(
      fc.property(referenceArb, (ref) => {
        const w = computePeriodWindow('monthly', ref, TZ);
        const year = ref.getUTCFullYear();
        const month = ref.getUTCMonth() + 1;
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        expect(w.start).toBe(`${year}-${month.toString().padStart(2, '0')}-01`);
        expect(w.end).toBe(
          `${year}-${month.toString().padStart(2, '0')}-${lastDay
            .toString()
            .padStart(2, '0')}`,
        );
        expect(w.start <= w.end).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('February 2024 (leap) monthly window ends on the 29th; 2023 on the 28th', () => {
    expect(
      computePeriodWindow('monthly', new Date(Date.UTC(2024, 1, 10)), TZ).end,
    ).toBe('2024-02-29');
    expect(
      computePeriodWindow('monthly', new Date(Date.UTC(2023, 1, 10)), TZ).end,
    ).toBe('2023-02-28');
  });

  it('yearly window is Jan 1..Dec 31 of the reference year', async () => {
    fc.assert(
      fc.property(referenceArb, (ref) => {
        const w = computePeriodWindow('yearly', ref, TZ);
        const year = ref.getUTCFullYear();
        expect(w.start).toBe(`${year}-01-01`);
        expect(w.end).toBe(`${year}-12-31`);
        expect(w.start <= w.end).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('weekly window is Monday..Sunday, spans exactly 7 days, and contains the reference day', async () => {
    fc.assert(
      fc.property(referenceArb, (ref) => {
        const w = computePeriodWindow('weekly', ref, TZ);
        const ymd = refYmd(ref);

        // Monday start, Sunday end.
        expect(windowBoundToDate(w.start).getUTCDay()).toBe(1); // Monday
        expect(windowBoundToDate(w.end).getUTCDay()).toBe(0); // Sunday
        // Exactly 7 days inclusive.
        expect(daysBetweenInclusive(w.start, w.end)).toBe(7);
        // Contains the reference day.
        expect(w.start <= ymd && ymd <= w.end).toBe(true);
        expect(w.start <= w.end).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// DB-GATED — getStatus over seeded expenses (skipped without a DB).
// ---------------------------------------------------------------------------
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeDb = DATABASE_TEST_URL ? describe : describe.skip;

describeDb(
  'Property 25 (DB) — budget status computation (Req 10.1, 10.2, 10.3, 10.5)',
  () => {
    let prisma: PrismaClient;
    let service: BudgetsService;
    const config = { platformTimezone: 'UTC' } as unknown as AppConfigService;

    // A fixed reference instant → deterministic monthly window (March 2024).
    const referenceNow = new Date(Date.UTC(2024, 2, 15));

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
      service = new BudgetsService(prisma as unknown as PrismaService, config);
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

    // In-window March day (YYYY-MM-DD).
    const inWindowDayArb = fc
      .integer({ min: 1, max: 31 })
      .map((d) => `2024-03-${d.toString().padStart(2, '0')}`);
    // Out-of-window day (Feb or April 2024).
    const outWindowDayArb = fc.oneof(
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
    const limitArb = fc
      .integer({ min: 1, max: 99_999_999 })
      .map((cents) => (cents / 100).toFixed(2));

    const dateOnly = (ymd: string): Date => windowBoundToDate(ymd);

    it('total equals the in-scope in-period sum; remaining/status/exceeded and zero-spend behavior hold', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.record({ day: inWindowDayArb, amount: amountArb }), {
            minLength: 0,
            maxLength: 10,
          }),
          fc.array(fc.record({ day: outWindowDayArb, amount: amountArb }), {
            minLength: 0,
            maxLength: 5,
          }),
          fc.array(fc.record({ day: inWindowDayArb, amount: amountArb }), {
            minLength: 0,
            maxLength: 5,
          }),
          limitArb,
          async (inScope, outOfWindow, otherCategoryInWindow, limit) => {
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

            const scopedCat = await prisma.category.create({
              data: { userId: owner.id, name: 'Scoped', nameCi: 'scoped' },
            });
            const otherCat = await prisma.category.create({
              data: { userId: owner.id, name: 'Other', nameCi: 'other' },
            });
            const foreignCat = await prisma.category.create({
              data: { userId: other.id, name: 'Foreign', nameCi: 'foreign' },
            });

            // Category-scoped budget over the fixed monthly window.
            const budget = await prisma.budget.create({
              data: {
                userId: owner.id,
                categoryId: scopedCat.id,
                limitAmount: new Prisma.Decimal(limit),
                period: 'monthly',
              },
            });

            // In-scope, in-period expenses (these SHOULD be counted).
            for (const e of inScope) {
              await prisma.expense.create({
                data: {
                  userId: owner.id,
                  categoryId: scopedCat.id,
                  amount: new Prisma.Decimal(e.amount),
                  currency: 'USD',
                  date: dateOnly(e.day),
                },
              });
            }
            // Out-of-window, correct-category (excluded — outside window).
            for (const e of outOfWindow) {
              await prisma.expense.create({
                data: {
                  userId: owner.id,
                  categoryId: scopedCat.id,
                  amount: new Prisma.Decimal(e.amount),
                  currency: 'USD',
                  date: dateOnly(e.day),
                },
              });
            }
            // In-window, OTHER category (excluded — wrong scope).
            for (const e of otherCategoryInWindow) {
              await prisma.expense.create({
                data: {
                  userId: owner.id,
                  categoryId: otherCat.id,
                  amount: new Prisma.Decimal(e.amount),
                  currency: 'USD',
                  date: dateOnly(e.day),
                },
              });
            }
            // Another user's in-window scoped-like expense (excluded — foreign).
            await prisma.expense.create({
              data: {
                userId: other.id,
                categoryId: foreignCat.id,
                amount: new Prisma.Decimal('123.45'),
                currency: 'USD',
                date: dateOnly('2024-03-10'),
              },
            });

            const expectedTotal = inScope.reduce(
              (acc, e) => acc.plus(new Prisma.Decimal(e.amount)),
              new Prisma.Decimal(0),
            );
            const limitDec = new Prisma.Decimal(limit);
            const expectedRemaining = limitDec.minus(expectedTotal);
            const isExceeded = expectedTotal.greaterThan(limitDec);

            const status = await service.getStatus(
              owner.id,
              budget.id,
              referenceNow,
            );

            expect(status.budgetId).toBe(budget.id);
            expect(status.period).toBe('monthly');
            expect(status.limit).toBe(limitDec.toFixed(2));

            // Total equals the arithmetic sum of in-scope, in-period amounts
            // (tolerance 0.01).
            expect(
              Math.abs(Number(status.total) - Number(expectedTotal.toFixed(2))),
            ).toBeLessThanOrEqual(0.01);

            // Remaining = limit - total.
            expect(status.remaining).toBe(expectedRemaining.toFixed(2));

            if (isExceeded) {
              expect(status.status).toBe('exceeded');
              expect(status.exceeded).toBe(
                expectedTotal.minus(limitDec).toFixed(2),
              );
            } else {
              expect(status.status).toBe('within_limit');
              expect(Number(status.remaining)).toBeGreaterThanOrEqual(0);
              expect(status.exceeded).toBeUndefined();
            }

            // Zero in-scope → total 0.00, remaining = limit, within_limit.
            if (inScope.length === 0) {
              expect(status.total).toBe('0.00');
              expect(status.remaining).toBe(limitDec.toFixed(2));
              expect(status.status).toBe('within_limit');
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  },
);
