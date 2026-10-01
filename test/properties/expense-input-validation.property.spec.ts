import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import * as fc from 'fast-check';
import { CreateExpenseDto } from '../../src/expenses/dto/create-expense.dto';
import { UpdateExpenseDto } from '../../src/expenses/dto/update-expense.dto';
import {
  IsMoneyAmount,
  MONEY_MAX,
} from '../../src/expenses/dto/money.validator';
import {
  ExpensesService,
  VALIDATION_ERROR_CODE,
} from '../../src/expenses/expenses.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { AppConfigService } from '../../src/config/app-config.service';

/**
 * // Feature: smart-expense-insights-platform, Property 19
 *
 * Property 19: Expense input validation rejects invalid values without mutation
 * (Req 4.2, 4.3, 4.5, 6.2, 6.4).
 *
 * This file is split into a PURE part (always runs) and a DB-GATED part
 * (skipped without DATABASE_TEST_URL):
 *
 *  - PURE: the field-level rules that the global `ValidationPipe` enforces are
 *    exercised directly through class-validator (`plainToInstance` + `validate`)
 *    on {@link CreateExpenseDto}/{@link UpdateExpenseDto}, plus a direct probe of
 *    the {@link IsMoneyAmount} validator. Arbitrary invalid amount / currency /
 *    date / description inputs FAIL naming the offending field; arbitrary valid
 *    inputs PASS.
 *  - DB-GATED: the two rules that require the service + a real row — a category
 *    not owned by the user, and a future date — are asserted at the service
 *    layer, verifying the request is rejected (400 VALIDATION_ERROR) and no row
 *    is created or modified.
 */

// ---------------------------------------------------------------------------
// PURE — DTO field validation (always runs, no database).
// ---------------------------------------------------------------------------
describe('Property 19 (pure) — expense DTO field validation (Req 4.2, 4.5, 6.2)', () => {
  const failingFields = async (
    Dto: typeof CreateExpenseDto | typeof UpdateExpenseDto,
    payload: Record<string, unknown>,
  ): Promise<string[]> => {
    const dto = plainToInstance(Dto, payload);
    const errors: ValidationError[] = await validate(dto);
    return errors.map((e) => e.property);
  };

  // A valid two-decimal money string in [0.01, MONEY_MAX].
  const validAmountArb = fc
    .integer({ min: 1, max: 99_999_999_999 })
    .map((cents) => (cents / 100).toFixed(2))
    .filter((s) => Number(s) >= 0.01 && Number(s) <= MONEY_MAX);

  // A valid, non-future-safe calendar date well in the past (YYYY-MM-DD).
  const validDateArb = fc
    .date({
      min: new Date(Date.UTC(2000, 0, 1)),
      max: new Date(Date.UTC(2020, 11, 31)),
      noInvalidDate: true,
    })
    .map((d) => d.toISOString().slice(0, 10));

  const currencyArb = fc.constantFrom('USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD');
  const categoryIdArb = fc.uuid({ version: 4 });

  it('accepts arbitrary valid create payloads', async () => {
    await fc.assert(
      fc.asyncProperty(
        validAmountArb,
        currencyArb,
        validDateArb,
        categoryIdArb,
        fc.option(fc.string({ maxLength: 500 }), { nil: undefined }),
        async (amount, currency, date, categoryId, description) => {
          const payload: Record<string, unknown> = {
            amount,
            currency,
            date,
            categoryId,
          };
          if (description !== undefined) {
            payload.description = description;
          }
          expect(await failingFields(CreateExpenseDto, payload)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects invalid amounts (zero/negative/non-numeric/over-max/>2dp) naming amount', async () => {
    const invalidAmountArb = fc.oneof(
      // Zero / negative.
      fc.constantFrom('0', '0.00', '-1', '-0.01', '-999'),
      // Non-numeric.
      fc.constantFrom('abc', '', '1.2.3', '1e5', 'NaN', '$5', '1,000'),
      // More than two decimal places.
      fc.constantFrom('1.234', '0.001', '10.999', '5.005'),
      // Over the maximum.
      fc.integer({ min: 1, max: 5000 }).map((n) => (MONEY_MAX + n).toFixed(2)),
    );

    await fc.assert(
      fc.asyncProperty(
        invalidAmountArb,
        currencyArb,
        validDateArb,
        categoryIdArb,
        async (amount, currency, date, categoryId) => {
          const fields = await failingFields(CreateExpenseDto, {
            amount,
            currency,
            date,
            categoryId,
          });
          expect(fields).toContain('amount');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects unrecognized currency codes naming currency', async () => {
    // `@IsISO4217CurrencyCode` matches case-insensitively, so an invalid
    // currency is one that is not a recognized code in ANY casing. Use codes
    // that are structurally wrong (length/charset) or plainly not ISO 4217.
    const invalidCurrencyArb = fc.constantFrom(
      'US',
      'USDD',
      'ZZZ',
      'XXY',
      'QQQ',
      '123',
      '',
      'DOLLARS',
      'U$D',
    );

    await fc.assert(
      fc.asyncProperty(
        validAmountArb,
        invalidCurrencyArb,
        validDateArb,
        categoryIdArb,
        async (amount, currency, date, categoryId) => {
          const fields = await failingFields(CreateExpenseDto, {
            amount,
            currency,
            date,
            categoryId,
          });
          expect(fields).toContain('currency');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects invalid/malformed dates naming date', async () => {
    const invalidDateArb = fc.oneof(
      // Wrong shape.
      fc.constantFrom(
        '2024-1-1',
        '01-01-2024',
        '2024/01/01',
        '2024-01-01T00:00:00Z',
        'not-a-date',
        '',
        '20240101',
      ),
      // Well-formed shape but not a real calendar date.
      fc.constantFrom('2024-02-30', '2024-13-01', '2024-00-10', '2023-04-31'),
    );

    await fc.assert(
      fc.asyncProperty(
        validAmountArb,
        currencyArb,
        invalidDateArb,
        categoryIdArb,
        async (amount, currency, date, categoryId) => {
          const fields = await failingFields(CreateExpenseDto, {
            amount,
            currency,
            date,
            categoryId,
          });
          expect(fields).toContain('date');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects a description longer than 500 characters naming description', async () => {
    await fc.assert(
      fc.asyncProperty(
        validAmountArb,
        currencyArb,
        validDateArb,
        categoryIdArb,
        fc.integer({ min: 501, max: 2000 }),
        async (amount, currency, date, categoryId, len) => {
          const fields = await failingFields(CreateExpenseDto, {
            amount,
            currency,
            date,
            categoryId,
            description: 'x'.repeat(len),
          });
          expect(fields).toContain('description');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects a non-UUID categoryId naming categoryId', async () => {
    const invalidCategoryArb = fc
      .string({ maxLength: 40 })
      .filter(
        (s) =>
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            s,
          ),
      );

    await fc.assert(
      fc.asyncProperty(
        validAmountArb,
        currencyArb,
        validDateArb,
        invalidCategoryArb,
        async (amount, currency, date, categoryId) => {
          const fields = await failingFields(CreateExpenseDto, {
            amount,
            currency,
            date,
            categoryId,
          });
          expect(fields).toContain('categoryId');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects an invalid amount on a partial UpdateExpenseDto naming amount', async () => {
    const invalidAmountArb = fc.constantFrom(
      '0',
      '-5.00',
      '1.234',
      'abc',
      (MONEY_MAX + 1).toFixed(2),
    );

    await fc.assert(
      fc.asyncProperty(invalidAmountArb, async (amount) => {
        // A partial update carrying only an invalid amount must still fail.
        const fields = await failingFields(UpdateExpenseDto, { amount });
        expect(fields).toContain('amount');
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// PURE — direct probe of the IsMoneyAmount validator.
// ---------------------------------------------------------------------------
describe('Property 19 (pure) — IsMoneyAmount validator (Req 4.2, 6.2)', () => {
  class MoneyProbe {
    @IsMoneyAmount()
    amount!: unknown;
  }

  const isValid = async (amount: unknown): Promise<boolean> => {
    const dto = plainToInstance(MoneyProbe, { amount });
    const errors = await validate(dto);
    return errors.length === 0;
  };

  it('accepts two-decimal amounts in [0.01, MONEY_MAX]', async () => {
    const okArb = fc
      .integer({ min: 1, max: 99_999_999_999 })
      .map((cents) => (cents / 100).toFixed(2))
      .filter((s) => Number(s) >= 0.01 && Number(s) <= MONEY_MAX);

    await fc.assert(
      fc.asyncProperty(okArb, async (amount) => {
        expect(await isValid(amount)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects amounts <= 0, > MONEY_MAX, or with more than two decimals', async () => {
    const badArb = fc.oneof(
      // <= 0
      fc.constantFrom('0', '0.00', '-0.01', '-1', '-100.50'),
      // > MONEY_MAX
      fc
        .integer({ min: 1, max: 10_000 })
        .map((n) => (MONEY_MAX + n).toFixed(2)),
      // > 2 decimals
      fc.constantFrom('1.001', '0.005', '99.999', '5.1234'),
      // non-numeric
      fc.constantFrom('', 'abc', '1,00', '1.2.3'),
    );

    await fc.assert(
      fc.asyncProperty(badArb, async (amount) => {
        expect(await isValid(amount)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// DB-GATED — service-level rules requiring a real row (skipped without a DB).
// ---------------------------------------------------------------------------
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeDb = DATABASE_TEST_URL ? describe : describe.skip;

describeDb(
  'Property 19 (DB) — service rejects foreign category / future date without mutation (Req 4.3, 4.5, 6.4)',
  () => {
    let prisma: PrismaClient;
    let service: ExpensesService;

    // Minimal AppConfigService stub exposing only what ExpensesService reads.
    const config = {
      platformTimezone: 'UTC',
    } as unknown as AppConfigService;

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

    it('rejects creating an expense against a category the user does not own, creating nothing', async () => {
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
      // Category belongs to `other`, not `owner`.
      const foreignCategory = await prisma.category.create({
        data: { userId: other.id, name: 'Foreign', nameCi: 'foreign' },
      });

      await expect(
        service.create(owner.id, {
          amount: '10.00',
          currency: 'USD',
          date: '2020-01-01',
          categoryId: foreignCategory.id,
        }),
      ).rejects.toMatchObject({
        response: { code: VALIDATION_ERROR_CODE },
      });

      expect(await prisma.expense.count()).toBe(0);
    });

    it('rejects a future-dated expense, creating nothing', async () => {
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

      const future = new Date(Date.now() + 366 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      await expect(
        service.create(owner.id, {
          amount: '10.00',
          currency: 'USD',
          date: future,
          categoryId: category.id,
        }),
      ).rejects.toMatchObject({
        response: { code: VALIDATION_ERROR_CODE },
      });

      expect(await prisma.expense.count()).toBe(0);
    });

    it('leaves an owned expense unchanged when an update references a foreign category', async () => {
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
      const ownCategory = await prisma.category.create({
        data: { userId: owner.id, name: 'Own', nameCi: 'own' },
      });
      const foreignCategory = await prisma.category.create({
        data: { userId: other.id, name: 'Foreign', nameCi: 'foreign' },
      });
      const created = await service.create(owner.id, {
        amount: '25.00',
        currency: 'USD',
        date: '2020-06-15',
        categoryId: ownCategory.id,
      });

      await expect(
        service.update(owner.id, created.id, {
          categoryId: foreignCategory.id,
        }),
      ).rejects.toMatchObject({
        response: { code: VALIDATION_ERROR_CODE },
      });

      const reloaded = await service.findOne(owner.id, created.id);
      expect(reloaded.categoryId).toBe(ownCategory.id);
      expect(reloaded.amount).toBe('25.00');
    });
  },
);
