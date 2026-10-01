import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/**
 * GATED live-database integration tests (Task 2.4, Req 1.2, 8.3, 8.7).
 *
 * These tests verify the real database enforces the schema guarantees. They are
 * SKIPPED unless `DATABASE_TEST_URL` is set, so `npm test` stays green in
 * environments with no PostgreSQL available.
 *
 * To run them locally:
 *   1. Start a throwaway PostgreSQL (e.g. Docker — see README "Database"):
 *        docker run --rm -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
 *   2. Point the test at it and run the suite:
 *        DATABASE_TEST_URL="postgresql://postgres:postgres@localhost:5432/expense_test" npm test
 *
 * On startup this spec applies the committed migrations with
 * `prisma migrate deploy` against DATABASE_TEST_URL, then exercises:
 *  - case-insensitive email uniqueness (Req 1.2);
 *  - per-user case-insensitive category uniqueness (Req 8.3);
 *  - category delete-restrict when referenced by an expense (Req 8.7);
 *  - budget.categoryId SET NULL when its category is deleted;
 *  - Decimal(12,2) round-trips at two decimal places.
 */
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeLiveDb = DATABASE_TEST_URL ? describe : describe.skip;

describeLiveDb(
  'persistence against a live database (Req 1.2, 8.3, 8.7)',
  () => {
    let prisma: PrismaClient;

    beforeAll(async () => {
      // Apply the committed migrations to the test database non-interactively.
      execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: DATABASE_TEST_URL },
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });

      prisma = new PrismaClient({
        datasources: { db: { url: DATABASE_TEST_URL } },
      });
      await prisma.$connect();
    });

    afterAll(async () => {
      if (prisma) {
        await prisma.$disconnect();
      }
    });

    // Start each test from a clean slate; order respects FK constraints.
    beforeEach(async () => {
      await prisma.budget.deleteMany();
      await prisma.expense.deleteMany();
      await prisma.category.deleteMany();
      await prisma.user.deleteMany();
      await prisma.loginAttempt.deleteMany();
    });

    const makeUser = (suffix: string) =>
      prisma.user.create({
        data: {
          email: `User+${suffix}@Example.com`,
          emailCi: `user+${suffix}@example.com`,
          passwordHash: 'hash',
        },
      });

    it('rejects a second user whose email normalizes to an existing emailCi (Req 1.2)', async () => {
      await prisma.user.create({
        data: {
          email: 'Owner@Example.com',
          emailCi: 'owner@example.com',
          passwordHash: 'hash',
        },
      });

      await expect(
        prisma.user.create({
          data: {
            // Different original casing, SAME normalized emailCi.
            email: 'OWNER@EXAMPLE.COM',
            emailCi: 'owner@example.com',
            passwordHash: 'hash',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      expect(await prisma.user.count()).toBe(1);
    });

    it('rejects duplicate (userId, nameCi) categories (Req 8.3)', async () => {
      const user = await makeUser('cat');
      await prisma.category.create({
        data: { userId: user.id, name: 'Groceries', nameCi: 'groceries' },
      });

      await expect(
        prisma.category.create({
          data: { userId: user.id, name: 'GROCERIES', nameCi: 'groceries' },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      expect(await prisma.category.count({ where: { userId: user.id } })).toBe(
        1,
      );
    });

    it('blocks deleting a category referenced by an expense (Req 8.7)', async () => {
      const user = await makeUser('restrict');
      const category = await prisma.category.create({
        data: { userId: user.id, name: 'Utilities', nameCi: 'utilities' },
      });
      await prisma.expense.create({
        data: {
          userId: user.id,
          categoryId: category.id,
          amount: '10.00',
          currency: 'USD',
          date: new Date('2024-01-01'),
        },
      });

      // ON DELETE RESTRICT → Prisma surfaces a foreign-key constraint failure.
      await expect(
        prisma.category.delete({ where: { id: category.id } }),
      ).rejects.toMatchObject({ code: 'P2003' });

      expect(await prisma.category.count({ where: { id: category.id } })).toBe(
        1,
      );
    });

    it('nulls a budget scope when its (unreferenced) category is deleted (SET NULL)', async () => {
      const user = await makeUser('setnull');
      const category = await prisma.category.create({
        data: { userId: user.id, name: 'Travel', nameCi: 'travel' },
      });
      const budget = await prisma.budget.create({
        data: {
          userId: user.id,
          categoryId: category.id,
          limitAmount: '500.00',
          period: 'monthly',
        },
      });

      // No expenses reference the category, so deletion succeeds and the budget's
      // categoryId is set to NULL rather than blocking or cascading.
      await prisma.category.delete({ where: { id: category.id } });

      const reloaded = await prisma.budget.findUniqueOrThrow({
        where: { id: budget.id },
      });
      expect(reloaded.categoryId).toBeNull();
    });

    it('round-trips Decimal money at two decimal places', async () => {
      const user = await makeUser('decimal');
      const category = await prisma.category.create({
        data: { userId: user.id, name: 'Dining', nameCi: 'dining' },
      });
      const created = await prisma.expense.create({
        data: {
          userId: user.id,
          categoryId: category.id,
          amount: '1234.56',
          currency: 'USD',
          date: new Date('2024-02-15'),
        },
      });

      const reloaded = await prisma.expense.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(reloaded.amount.toFixed(2)).toBe('1234.56');
    });
  },
);
