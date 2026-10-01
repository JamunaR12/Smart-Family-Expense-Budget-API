import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import * as fc from 'fast-check';
import {
  AnalyticsService,
  VALIDATION_ERROR_CODE,
} from '../../src/analytics/analytics.service';
import { MonthlyInsightQueryDto } from '../../src/analytics/dto/monthly-insight-query.dto';
import { CategoryInsightQueryDto } from '../../src/analytics/dto/category-insight-query.dto';
import { parseMonth } from '../../src/analytics/month-window';
import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * // Feature: smart-expense-insights-platform, Property 5
 *
 * Property 5: Invalid analytics range rejected (Req 11.6).
 *
 * This property is fully verifiable WITHOUT a database and therefore always
 * runs:
 *
 *  - PURE (DTO): the syntactic rules the global `ValidationPipe` enforces are
 *    exercised through class-validator (`plainToInstance` + `validate`). A
 *    missing/malformed `month`, `startDate`, or `endDate` FAILS naming the
 *    offending field; valid values PASS. `parseMonth` returns null for invalid
 *    months and `{year, month}` for valid ones.
 *  - PURE (service): the cross-field rule `startDate <= endDate` is checked in
 *    `AnalyticsService.byCategory` BEFORE any aggregation, so an inverted range
 *    is rejected with a VALIDATION_ERROR and NO aggregation is performed. This
 *    is proven with a Prisma stub whose `groupBy` throws if it is ever called.
 */

const failingFields = async <T extends object>(
  Dto: ClassConstructor<T>,
  payload: Record<string, unknown>,
): Promise<string[]> => {
  const dto = plainToInstance(Dto, payload);
  const errors: ValidationError[] = await validate(dto as object);
  return errors.map((e) => e.property);
};

// ---------------------------------------------------------------------------
// PURE — MonthlyInsightQueryDto month validation (always runs).
// ---------------------------------------------------------------------------
describe('Property 5 (pure) — monthly query validation (Req 11.6)', () => {
  const validMonthArb = fc
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

  it('accepts a valid YYYY-MM month', async () => {
    await fc.assert(
      fc.asyncProperty(validMonthArb, async (month) => {
        expect(await failingFields(MonthlyInsightQueryDto, { month })).toEqual(
          [],
        );
      }),
      { numRuns: 100 },
    );
  });

  it('rejects a missing/malformed month naming month', async () => {
    const invalidMonthArb = fc.oneof(
      // Wrong shape.
      fc.constantFrom(
        '',
        '2024',
        '2024-1',
        '202401',
        '2024/01',
        '2024-01-01',
        'not-a-month',
        'Jan-2024',
      ),
      // Month out of range 00 or 13..99.
      fc.constantFrom('2024-00', '2024-13', '2024-20', '2024-99'),
      // Missing entirely.
      fc.constant(undefined),
    );

    await fc.assert(
      fc.asyncProperty(invalidMonthArb, async (month) => {
        const payload = month === undefined ? {} : { month };
        expect(await failingFields(MonthlyInsightQueryDto, payload)).toContain(
          'month',
        );
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// PURE — CategoryInsightQueryDto date-bound validation (always runs).
// ---------------------------------------------------------------------------
describe('Property 5 (pure) — by-category query validation (Req 11.6)', () => {
  const validDateArb = fc
    .date({
      min: new Date(Date.UTC(2000, 0, 1)),
      max: new Date(Date.UTC(2030, 11, 31)),
      noInvalidDate: true,
    })
    .map((d) => d.toISOString().slice(0, 10));

  const invalidDateArb = fc.oneof(
    // Wrong shape.
    fc.constantFrom(
      '',
      '2024-1-1',
      '01-01-2024',
      '2024/01/01',
      '2024-01-01T00:00:00Z',
      '20240101',
      'not-a-date',
    ),
    // Well-formed shape but not a real calendar date.
    fc.constantFrom('2024-02-30', '2024-13-01', '2024-00-10', '2023-04-31'),
  );

  it('accepts a valid startDate/endDate pair', async () => {
    await fc.assert(
      fc.asyncProperty(
        validDateArb,
        validDateArb,
        async (startDate, endDate) => {
          expect(
            await failingFields(CategoryInsightQueryDto, {
              startDate,
              endDate,
            }),
          ).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects a missing/malformed startDate naming startDate', async () => {
    await fc.assert(
      fc.asyncProperty(
        invalidDateArb,
        validDateArb,
        async (startDate, endDate) => {
          expect(
            await failingFields(CategoryInsightQueryDto, {
              startDate,
              endDate,
            }),
          ).toContain('startDate');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects a missing startDate (absent) naming startDate', async () => {
    await fc.assert(
      fc.asyncProperty(validDateArb, async (endDate) => {
        expect(
          await failingFields(CategoryInsightQueryDto, { endDate }),
        ).toContain('startDate');
      }),
      { numRuns: 100 },
    );
  });

  it('rejects a missing/malformed endDate naming endDate', async () => {
    await fc.assert(
      fc.asyncProperty(
        validDateArb,
        invalidDateArb,
        async (startDate, endDate) => {
          expect(
            await failingFields(CategoryInsightQueryDto, {
              startDate,
              endDate,
            }),
          ).toContain('endDate');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects a missing endDate (absent) naming endDate', async () => {
    await fc.assert(
      fc.asyncProperty(validDateArb, async (startDate) => {
        expect(
          await failingFields(CategoryInsightQueryDto, { startDate }),
        ).toContain('endDate');
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// PURE — parseMonth totality (always runs).
// ---------------------------------------------------------------------------
describe('Property 5 (pure) — parseMonth totality (Req 11.6)', () => {
  it('returns {year, month} for valid months and null for invalid ones', () => {
    const validMonthArb = fc.record({
      year: fc.integer({ min: 0, max: 9999 }),
      month: fc.integer({ min: 1, max: 12 }),
    });

    fc.assert(
      fc.property(validMonthArb, ({ year, month }) => {
        const value = `${year.toString().padStart(4, '0')}-${month
          .toString()
          .padStart(2, '0')}`;
        expect(parseMonth(value)).toEqual({ year, month });
      }),
      { numRuns: 100 },
    );

    const invalidArb = fc.oneof(
      fc.constantFrom('', '2024', '2024-1', '2024-13', '2024-00', '2024-99'),
      fc.constantFrom('2024/01', '202401', 'x-01', '2024-01-01'),
    );
    fc.assert(
      fc.property(invalidArb, (value) => {
        expect(parseMonth(value)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// PURE (service) — inverted range rejected BEFORE any aggregation.
// ---------------------------------------------------------------------------
describe('Property 5 (pure/service) — inverted range rejected, no aggregation (Req 11.6)', () => {
  it('throws VALIDATION_ERROR and never calls groupBy when startDate > endDate', async () => {
    await fc.assert(
      fc.asyncProperty(
        // A strictly inverted [startDate, endDate] pair.
        fc
          .tuple(
            fc.date({
              min: new Date(Date.UTC(2000, 0, 1)),
              max: new Date(Date.UTC(2030, 11, 31)),
              noInvalidDate: true,
            }),
            fc.date({
              min: new Date(Date.UTC(2000, 0, 1)),
              max: new Date(Date.UTC(2030, 11, 31)),
              noInvalidDate: true,
            }),
          )
          .map(([a, b]) => [
            a.toISOString().slice(0, 10),
            b.toISOString().slice(0, 10),
          ])
          .filter(([a, b]) => a > b),
        async ([startDate, endDate]) => {
          let groupByCalled = false;
          const prismaStub = {
            expense: {
              groupBy: () => {
                groupByCalled = true;
                throw new Error(
                  'groupBy must not be called for an inverted range',
                );
              },
              aggregate: () => {
                throw new Error(
                  'aggregate must not be called for an inverted range',
                );
              },
            },
          } as unknown as PrismaService;

          const service = new AnalyticsService(prismaStub);

          await expect(
            service.byCategory('user-1', startDate, endDate),
          ).rejects.toMatchObject({
            response: { code: VALIDATION_ERROR_CODE },
          });

          expect(groupByCalled).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
