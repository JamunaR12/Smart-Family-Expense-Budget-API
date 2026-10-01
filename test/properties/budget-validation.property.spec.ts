import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import * as fc from 'fast-check';
import { CreateBudgetDto } from '../../src/budgets/dto/create-budget.dto';
import { UpdateBudgetDto } from '../../src/budgets/dto/update-budget.dto';
import { MONEY_MAX } from '../../src/expenses/dto/money.validator';
import {
  BudgetsService,
  VALIDATION_ERROR_CODE,
} from '../../src/budgets/budgets.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { AppConfigService } from '../../src/config/app-config.service';

/**
 * // Feature: smart-expense-insights-platform, Property 24
 *
 * Property 24: Budget creation validation (Req 9.3, 9.4, 9.5).
 *
 * This file is split into a PURE part (always runs) and a DB-GATED part
 * (skipped without DATABASE_TEST_URL):
 *
 *  - PURE: the field-level rules the global `ValidationPipe` enforces are
 *    exercised directly through class-validator on
 *    {@link CreateBudgetDto}/{@link UpdateBudgetDto}. Arbitrary invalid limit
 *    (zero/negative/non-numeric/over-max/>2dp) FAIL naming `limitAmount`;
 *    arbitrary invalid period (not weekly/monthly/yearly) FAIL naming
 *    `period`; arbitrary valid create payloads PASS.
 *  - DB-GATED: the ownership rule that needs a real row — a `categoryId` not
 *    owned by the user is rejected (400 VALIDATION_ERROR "not accessible")
 *    with NO budget created; an update referencing a foreign category leaves
 *    the stored budget unchanged.
 */

// ---------------------------------------------------------------------------
// PURE — DTO field validation (always runs, no database).
// ---------------------------------------------------------------------------
describe('Property 24 (pure) — budget DTO field validation (Req 9.3, 9.4)', () => {
  const failingFields = async (
    Dto: typeof CreateBudgetDto | typeof UpdateBudgetDto,
    payload: Record<string, unknown>,
  ): Promise<string[]> => {
    const dto = plainToInstance(Dto, payload);
    const errors: ValidationError[] = await validate(dto);
    return errors.map((e) => e.property);
  };

  const validLimitArb = fc
    .integer({ min: 1, max: 99_999_999_999 })
    .map((cents) => (cents / 100).toFixed(2))
    .filter((s) => Number(s) >= 0.01 && Number(s) <= MONEY_MAX);
  const validPeriodArb = fc.constantFrom('weekly', 'monthly', 'yearly');
  const categoryIdArb = fc.uuid({ version: 4 });

  it('accepts arbitrary valid create payloads', async () => {
    await fc.assert(
      fc.asyncProperty(
        validLimitArb,
        validPeriodArb,
        fc.option(categoryIdArb, { nil: undefined }),
        async (limitAmount, period, categoryId) => {
          const payload: Record<string, unknown> = { limitAmount, period };
          if (categoryId !== undefined) {
            payload.categoryId = categoryId;
          }
          expect(await failingFields(CreateBudgetDto, payload)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects invalid limitAmount (zero/negative/non-numeric/over-max/>2dp) naming limitAmount', async () => {
    const invalidLimitArb = fc.oneof(
      fc.constantFrom('0', '0.00', '-1', '-0.01', '-999'),
      fc.constantFrom('abc', '', '1.2.3', '1e5', 'NaN', '$5', '1,000'),
      fc.constantFrom('1.234', '0.001', '10.999', '5.005'),
      fc.integer({ min: 1, max: 5000 }).map((n) => (MONEY_MAX + n).toFixed(2)),
    );

    await fc.assert(
      fc.asyncProperty(
        invalidLimitArb,
        fc.constantFrom('weekly', 'monthly', 'yearly'),
        async (limitAmount, period) => {
          const fields = await failingFields(CreateBudgetDto, {
            limitAmount,
            period,
          });
          expect(fields).toContain('limitAmount');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects an invalid period naming period', async () => {
    const invalidPeriodArb = fc
      .oneof(
        fc.constantFrom('daily', 'quarterly', 'WEEKLY', 'Monthly', '', 'week'),
        fc.string({ maxLength: 12 }),
      )
      .filter((s) => !['weekly', 'monthly', 'yearly'].includes(s));

    await fc.assert(
      fc.asyncProperty(
        validLimitArb,
        invalidPeriodArb,
        async (limitAmount, period) => {
          const fields = await failingFields(CreateBudgetDto, {
            limitAmount,
            period,
          });
          expect(fields).toContain('period');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects an invalid limitAmount on a partial UpdateBudgetDto naming limitAmount', async () => {
    const invalidLimitArb = fc.constantFrom(
      '0',
      '-5.00',
      '1.234',
      'abc',
      (MONEY_MAX + 1).toFixed(2),
    );

    await fc.assert(
      fc.asyncProperty(invalidLimitArb, async (limitAmount) => {
        const fields = await failingFields(UpdateBudgetDto, { limitAmount });
        expect(fields).toContain('limitAmount');
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// DB-GATED — service rejects foreign category without mutation.
// ---------------------------------------------------------------------------
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeDb = DATABASE_TEST_URL ? describe : describe.skip;

describeDb(
  'Property 24 (DB) — service rejects foreign category without mutation (Req 9.5)',
  () => {
    let prisma: PrismaClient;
    let service: BudgetsService;
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

    it('rejects creating a budget scoped to a category the user does not own, creating nothing', async () => {
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
      const foreignCategory = await prisma.category.create({
        data: { userId: other.id, name: 'Foreign', nameCi: 'foreign' },
      });

      await expect(
        service.create(owner.id, {
          limitAmount: '500.00',
          period: 'monthly',
          categoryId: foreignCategory.id,
        }),
      ).rejects.toMatchObject({
        response: { code: VALIDATION_ERROR_CODE },
      });

      expect(await prisma.budget.count()).toBe(0);
    });

    it('leaves an owned budget unchanged when an update references a foreign category', async () => {
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
        limitAmount: '500.00',
        period: 'monthly',
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
      expect(reloaded.limitAmount).toBe('500.00');
    });
  },
);
