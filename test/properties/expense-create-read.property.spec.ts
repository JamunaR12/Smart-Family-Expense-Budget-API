import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import * as fc from 'fast-check';
import { ExpensesService } from '../../src/expenses/expenses.service';
import { MONEY_MAX } from '../../src/expenses/dto/money.validator';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { AppConfigService } from '../../src/config/app-config.service';

/**
 * // Feature: smart-expense-insights-platform, Property 16
 *
 * Property 16: Expense create/read round-trip (Req 4.1, 4.6, 5.1).
 *
 * DB-GATED. Skipped unless DATABASE_TEST_URL is set. For arbitrary VALID
 * payloads (valid two-decimal amount, ISO 4217 currency, non-future date, an
 * owned category, and an optional description <= 500 chars), creating the
 * expense and then reading it back as the owner returns an expense with a
 * unique identifier and the SAME field values — the amount as a two-decimal
 * string, the date as YYYY-MM-DD, and the description preserved (null when
 * omitted).
 */
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeDb = DATABASE_TEST_URL ? describe : describe.skip;

describeDb(
  'Property 16 (DB) — create/read round-trip (Req 4.1, 4.6, 5.1)',
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

    it('creates then reads back the same field values with a unique id', async () => {
      await fc.assert(
        fc.asyncProperty(
          amountArb,
          currencyArb,
          dateArb,
          fc.option(fc.string({ maxLength: 500 }), { nil: undefined }),
          async (amount, currency, date, description) => {
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
            const category = await prisma.category.create({
              data: { userId: owner.id, name: 'Food', nameCi: 'food' },
            });

            const created = await service.create(owner.id, {
              amount,
              currency,
              date,
              categoryId: category.id,
              ...(description !== undefined ? { description } : {}),
            });

            expect(created.id).toBeTruthy();

            const read = await service.findOne(owner.id, created.id);

            expect(read.id).toBe(created.id);
            expect(read.categoryId).toBe(category.id);
            // Amount is a two-decimal string equal to the normalized input.
            expect(read.amount).toBe(Number(amount).toFixed(2));
            expect(read.currency).toBe(currency.toUpperCase());
            expect(read.date).toBe(date);
            expect(read.description).toBe(description ?? null);
          },
        ),
        { numRuns: 100 },
      );
    });
  },
);
