import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import * as fc from 'fast-check';
import { ExpensesService } from '../../src/expenses/expenses.service';
import { MONEY_MAX } from '../../src/expenses/dto/money.validator';
import type { UpdateExpenseDto } from '../../src/expenses/dto/update-expense.dto';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { AppConfigService } from '../../src/config/app-config.service';

/**
 * // Feature: smart-expense-insights-platform, Property 17
 *
 * Property 17: Expense update round-trip (Req 6.1).
 *
 * DB-GATED. Skipped unless DATABASE_TEST_URL is set. For an owned expense and
 * an arbitrary VALID partial update (any subset of amount / currency / date /
 * description, plus optionally switching to another owned category), reading
 * the expense afterward reflects EXACTLY the applied changes; untouched fields
 * keep their prior values.
 */
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeDb = DATABASE_TEST_URL ? describe : describe.skip;

describeDb('Property 17 (DB) — update round-trip (Req 6.1)', () => {
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

  const amountArb = fc
    .integer({ min: 1, max: 99_999_999_999 })
    .map((cents) => (cents / 100).toFixed(2))
    .filter((s) => Number(s) >= 0.01 && Number(s) <= MONEY_MAX);
  const currencyArb = fc.constantFrom('USD', 'EUR', 'GBP', 'JPY', 'CAD');
  const dateArb = fc
    .date({
      min: new Date(Date.UTC(2000, 0, 1)),
      max: new Date(Date.UTC(2020, 11, 31)),
      noInvalidDate: true,
    })
    .map((d) => d.toISOString().slice(0, 10));

  // An arbitrary non-empty partial update.
  const patchArb = fc
    .record(
      {
        amount: fc.option(amountArb, { nil: undefined }),
        currency: fc.option(currencyArb, { nil: undefined }),
        date: fc.option(dateArb, { nil: undefined }),
        description: fc.option(
          fc.oneof(fc.string({ maxLength: 500 }), fc.constant(null)),
          { nil: undefined },
        ),
        switchCategory: fc.boolean(),
      },
      { requiredKeys: ['switchCategory'] },
    )
    .filter(
      (p) =>
        p.amount !== undefined ||
        p.currency !== undefined ||
        p.date !== undefined ||
        p.description !== undefined ||
        p.switchCategory,
    );

  it('reflects exactly the applied changes on a subsequent read', async () => {
    await fc.assert(
      fc.asyncProperty(patchArb, async (patch) => {
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
        const catA = await prisma.category.create({
          data: { userId: owner.id, name: 'A', nameCi: 'a' },
        });
        const catB = await prisma.category.create({
          data: { userId: owner.id, name: 'B', nameCi: 'b' },
        });

        const created = await service.create(owner.id, {
          amount: '10.00',
          currency: 'USD',
          date: '2020-01-01',
          categoryId: catA.id,
          description: 'original',
        });

        const dto: UpdateExpenseDto = {};
        if (patch.amount !== undefined) dto.amount = patch.amount;
        if (patch.currency !== undefined) dto.currency = patch.currency;
        if (patch.date !== undefined) dto.date = patch.date;
        if (patch.description !== undefined)
          dto.description = patch.description as string;
        if (patch.switchCategory) dto.categoryId = catB.id;

        await service.update(owner.id, created.id, dto);
        const read = await service.findOne(owner.id, created.id);

        // Each changed field reflects the update; untouched fields are unchanged.
        expect(read.amount).toBe(
          patch.amount !== undefined
            ? Number(patch.amount).toFixed(2)
            : '10.00',
        );
        expect(read.currency).toBe(
          patch.currency !== undefined ? patch.currency.toUpperCase() : 'USD',
        );
        expect(read.date).toBe(
          patch.date !== undefined ? patch.date : '2020-01-01',
        );
        expect(read.description).toBe(
          patch.description !== undefined
            ? (patch.description as string | null)
            : 'original',
        );
        expect(read.categoryId).toBe(patch.switchCategory ? catB.id : catA.id);
      }),
      { numRuns: 100 },
    );
  });
});
