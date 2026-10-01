import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import * as fc from 'fast-check';
import { ownerScope } from '../../src/common/owner-scope';

/**
 * // Feature: smart-expense-insights-platform, Property 7
 *
 * Property 7: Data isolation — collections (Req 3.3, 5.2, 8.4, 9.6, 11.3).
 *
 * A list/collection returned to a user contains ONLY that user's records, and
 * is empty when the user owns none. The design's primary isolation mechanism is
 * the owner-scoped query: every `findMany` merges `ownerScope(userId)` into its
 * `where` clause.
 *
 * This file has TWO parts:
 *  - a PURE part (always runs) proving `ownerScope(userId)` always yields a
 *    where-fragment pinned to exactly that userId for arbitrary ids; and
 *  - a DB-GATED part (skipped without DATABASE_TEST_URL) proving that a real
 *    owner-scoped `findMany` returns only the owner's rows and `[]` otherwise.
 */
describe('Property 7 (pure) — ownerScope pins every query to the owner (Req 3.3)', () => {
  it('ownerScope(userId) yields a where-fragment scoped to exactly that user', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (userId) => {
        const scope = ownerScope(userId);
        // Exactly one key, and it pins userId to the caller.
        expect(Object.keys(scope)).toEqual(['userId']);
        expect(scope.userId).toBe(userId);
      }),
      { numRuns: 100 },
    );
  });

  it('a where clause built from ownerScope never targets another user', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (owner, other) => {
        fc.pre(owner !== other);
        const where = { ...ownerScope(owner) };
        // The composed clause matches the owner and cannot match `other`.
        expect(where.userId).toBe(owner);
        expect(where.userId).not.toBe(other);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * DB-GATED. Skipped unless DATABASE_TEST_URL is set (mirrors
 * test/integration/persistence.integration.spec.ts). Applies the committed
 * migrations, seeds two users with expenses, and asserts owner-scoped listing
 * returns only the owner's rows.
 */
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeDb = DATABASE_TEST_URL ? describe : describe.skip;

describeDb(
  'Property 7 (DB) — owner-scoped listing returns only the owner rows (Req 3.3)',
  () => {
    let prisma: PrismaClient;

    beforeAll(() => {
      execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: DATABASE_TEST_URL },
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      prisma = new PrismaClient({
        datasources: { db: { url: DATABASE_TEST_URL } },
      });
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

    it('each user only ever sees their own expenses; empty when none owned', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 5 }),
          fc.integer({ min: 0, max: 5 }),
          async (aCount, bCount) => {
            await prisma.budget.deleteMany();
            await prisma.expense.deleteMany();
            await prisma.category.deleteMany();
            await prisma.user.deleteMany();

            const userA = await prisma.user.create({
              data: {
                email: 'A@example.com',
                emailCi: 'a@example.com',
                passwordHash: 'hash',
              },
            });
            const userB = await prisma.user.create({
              data: {
                email: 'B@example.com',
                emailCi: 'b@example.com',
                passwordHash: 'hash',
              },
            });
            const catA = await prisma.category.create({
              data: { userId: userA.id, name: 'A', nameCi: 'a' },
            });
            const catB = await prisma.category.create({
              data: { userId: userB.id, name: 'B', nameCi: 'b' },
            });

            for (let i = 0; i < aCount; i++) {
              await prisma.expense.create({
                data: {
                  userId: userA.id,
                  categoryId: catA.id,
                  amount: '1.00',
                  currency: 'USD',
                  date: new Date('2024-01-01'),
                },
              });
            }
            for (let i = 0; i < bCount; i++) {
              await prisma.expense.create({
                data: {
                  userId: userB.id,
                  categoryId: catB.id,
                  amount: '2.00',
                  currency: 'USD',
                  date: new Date('2024-01-01'),
                },
              });
            }

            const aRows = await prisma.expense.findMany({
              where: ownerScope(userA.id),
            });
            const bRows = await prisma.expense.findMany({
              where: ownerScope(userB.id),
            });

            expect(aRows).toHaveLength(aCount);
            expect(aRows.every((r) => r.userId === userA.id)).toBe(true);
            expect(bRows).toHaveLength(bCount);
            expect(bRows.every((r) => r.userId === userB.id)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  },
);
