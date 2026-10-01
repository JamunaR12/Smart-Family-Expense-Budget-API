import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import * as fc from 'fast-check';
import {
  DEFAULT_LIMIT,
  DEFAULT_OFFSET,
  ListExpensesQueryDto,
} from '../../src/expenses/dto/list-expenses-query.dto';
import {
  ExpensesService,
  VALIDATION_ERROR_CODE,
} from '../../src/expenses/expenses.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { AppConfigService } from '../../src/config/app-config.service';

/**
 * // Feature: smart-expense-insights-platform, Property 21
 *
 * Property 21: Malformed list parameters rejected (Req 5.10).
 *
 * PURE / NO-DB. A malformed pagination, date-range, or category parameter must
 * be rejected by the same {@link ListExpensesQueryDto} validation the global
 * `ValidationPipe` runs, and the failing PARAMETER must be named. Because the
 * pipe runs with `transform: true`, this test mirrors it by transforming the
 * raw query object (`plainToInstance` with `enableImplicitConversion`) before
 * validating, so `@Type(() => Number)` coercion is applied.
 *
 * A pure sub-check also confirms the DTO applies its defaults (limit 20,
 * offset 0) and coerces numeric query strings. The cross-field
 * `startDate > endDate` rule is a service-level check (Req 5.10) and is covered
 * in the DB-gated section below.
 */
describe('Property 21 (pure) — malformed list parameters rejected (Req 5.10)', () => {
  const failingFields = async (
    payload: Record<string, unknown>,
  ): Promise<string[]> => {
    const dto = plainToInstance(ListExpensesQueryDto, payload, {
      enableImplicitConversion: true,
    });
    const errors: ValidationError[] = await validate(dto);
    return errors.map((e) => e.property);
  };

  it('rejects an out-of-range or non-integer limit naming limit', async () => {
    const badLimitArb = fc.oneof(
      // Below the minimum (1).
      fc.integer({ min: -100, max: 0 }).map(String),
      // Above the maximum (100).
      fc.integer({ min: 101, max: 100_000 }).map(String),
      // Non-integer / non-numeric (empty string coerces to 0, which is < the
      // minimum of 1, so it is still caught — but keep the set unambiguous).
      fc.constantFrom('abc', '1.5', 'ten', '10x', 'NaN'),
    );

    await fc.assert(
      fc.asyncProperty(badLimitArb, async (limit) => {
        const fields = await failingFields({ limit });
        expect(fields).toContain('limit');
      }),
      { numRuns: 100 },
    );
  });

  it('rejects a negative or non-integer offset naming offset', async () => {
    // Note: an empty string coerces to 0 (a valid offset), so it is excluded.
    const badOffsetArb = fc.oneof(
      fc.integer({ min: -100_000, max: -1 }).map(String),
      fc.constantFrom('abc', '2.7', 'five', '3x', 'NaN'),
    );

    await fc.assert(
      fc.asyncProperty(badOffsetArb, async (offset) => {
        const fields = await failingFields({ offset });
        expect(fields).toContain('offset');
      }),
      { numRuns: 100 },
    );
  });

  it('rejects a malformed startDate/endDate naming the date parameter', async () => {
    const badDateArb = fc.oneof(
      fc.constantFrom(
        '2024-1-1',
        '01/01/2024',
        'yesterday',
        '2024-02-30',
        '2024-13-01',
        '20240101',
        '',
      ),
      fc
        .string({ maxLength: 12 })
        .filter((s) => !/^\d{4}-\d{2}-\d{2}$/.test(s)),
    );

    await fc.assert(
      fc.asyncProperty(
        badDateArb,
        fc.constantFrom('startDate', 'endDate'),
        async (value, param) => {
          const fields = await failingFields({ [param]: value });
          expect(fields).toContain(param);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects a non-UUID categoryId naming categoryId', async () => {
    const badCategoryArb = fc
      .string({ maxLength: 40 })
      .filter(
        (s) =>
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            s,
          ),
      );

    await fc.assert(
      fc.asyncProperty(badCategoryArb, async (categoryId) => {
        const fields = await failingFields({ categoryId });
        expect(fields).toContain('categoryId');
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 21 (pure) — list query defaults and numeric coercion', () => {
  it('applies default limit/offset when omitted', async () => {
    const dto = plainToInstance(
      ListExpensesQueryDto,
      {},
      { enableImplicitConversion: true },
    );
    expect(await validate(dto)).toEqual([]);
    expect(dto.limit).toBe(DEFAULT_LIMIT);
    expect(dto.offset).toBe(DEFAULT_OFFSET);
  });

  it('coerces valid numeric query strings to integers', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 100_000 }),
        async (limit, offset) => {
          const dto = plainToInstance(
            ListExpensesQueryDto,
            { limit: String(limit), offset: String(offset) },
            { enableImplicitConversion: true },
          );
          expect(await validate(dto)).toEqual([]);
          expect(dto.limit).toBe(limit);
          expect(dto.offset).toBe(offset);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// DB-GATED — the cross-field startDate > endDate rule is enforced in the
// service (Req 5.10) and needs the service wired to a real client.
// ---------------------------------------------------------------------------
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeDb = DATABASE_TEST_URL ? describe : describe.skip;

describeDb(
  'Property 21 (DB) — service rejects an inverted date range (Req 5.10)',
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

    it('rejects a list whose startDate is after its endDate, returning no expenses', async () => {
      const owner = await prisma.user.create({
        data: {
          email: 'Owner@Example.com',
          emailCi: 'owner@example.com',
          passwordHash: 'hash',
        },
      });

      const query = plainToInstance(ListExpensesQueryDto, {
        startDate: '2024-06-30',
        endDate: '2024-01-01',
      });

      await expect(service.findMany(owner.id, query)).rejects.toMatchObject({
        response: { code: VALIDATION_ERROR_CODE },
      });
    });
  },
);
