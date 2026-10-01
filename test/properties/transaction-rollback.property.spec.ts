import { execFileSync } from 'node:child_process';
import { ConflictException } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import * as fc from 'fast-check';
import { CategoriesService } from '../../src/categories/categories.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * // Feature: smart-expense-insights-platform, Property 29
 *
 * Property 29: Transactional rollback on internal failure (Req 13.5).
 *
 * DB-GATED. Proving that NO partial change is persisted requires a real
 * database, so this suite is SKIPPED unless `DATABASE_TEST_URL` is set (mirrors
 * the other DB-gated property specs). It applies the committed migrations with
 * `prisma migrate deploy` in `beforeAll` and cleans every table between runs.
 *
 * Two complementary checks:
 *  1. `CategoriesService.remove` runs its reference-count + delete inside one
 *     `prisma.$transaction`; when the category is referenced by an expense the
 *     callback throws a CONFLICT, so the whole unit rolls back — BOTH the
 *     category AND the referencing expense must remain (nothing partially
 *     deleted).
 *  2. A focused raw `prisma.$transaction` performing TWO writes where the
 *     SECOND throws: the FIRST write must not persist after rollback, proving
 *     the atomic-rollback guarantee the services rely on (Req 13.5).
 */
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeDb = DATABASE_TEST_URL ? describe : describe.skip;

describeDb(
  'Property 29 (DB) — transactional rollback on failure (Req 13.5)',
  () => {
    let prisma: PrismaClient;
    let categories: CategoriesService;

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
      categories = new CategoriesService(prisma as unknown as PrismaService);
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

    it('a category delete blocked by a referencing expense leaves BOTH rows intact', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc
            .integer({ min: 1, max: 99_999_999 })
            .map((c) => (c / 100).toFixed(2)),
          async (amount) => {
            await prisma.expense.deleteMany();
            await prisma.category.deleteMany();
            await prisma.user.deleteMany();

            const user = await prisma.user.create({
              data: {
                email: 'Owner@Example.com',
                emailCi: 'owner@example.com',
                passwordHash: 'hash',
              },
            });
            const category = await prisma.category.create({
              data: { userId: user.id, name: 'Utilities', nameCi: 'utilities' },
            });
            const expense = await prisma.expense.create({
              data: {
                userId: user.id,
                categoryId: category.id,
                amount: new Prisma.Decimal(amount),
                currency: 'USD',
                date: new Date('2024-01-01'),
              },
            });

            // remove() runs count + delete in one $transaction; the CONFLICT
            // thrown inside rolls the whole unit back.
            await expect(
              categories.remove(user.id, category.id),
            ).rejects.toBeInstanceOf(ConflictException);

            // Nothing was partially deleted — BOTH rows remain (Req 13.5).
            expect(
              await prisma.category.count({ where: { id: category.id } }),
            ).toBe(1);
            expect(
              await prisma.expense.count({ where: { id: expense.id } }),
            ).toBe(1);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('a two-write $transaction whose second write throws persists NEITHER write', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 3, maxLength: 12 }).map((s) => `cat_${s}`),
          async (rawName) => {
            await prisma.expense.deleteMany();
            await prisma.category.deleteMany();
            await prisma.user.deleteMany();

            const user = await prisma.user.create({
              data: {
                email: 'Tx@Example.com',
                emailCi: 'tx@example.com',
                passwordHash: 'hash',
              },
            });

            const name = rawName.trim();
            const nameCi = name.toLowerCase();

            // A transaction that creates a category (write #1) then throws before
            // committing (write #2 is a deliberate failure). The whole unit must
            // roll back, so the category from write #1 must NOT persist.
            await expect(
              prisma.$transaction(async (tx) => {
                await tx.category.create({
                  data: { userId: user.id, name, nameCi },
                });
                // Force a mid-transaction failure AFTER the first write.
                throw new Error('forced mid-transaction failure');
              }),
            ).rejects.toThrow('forced mid-transaction failure');

            // Write #1 rolled back — no category persisted (Req 13.5).
            expect(
              await prisma.category.count({ where: { userId: user.id } }),
            ).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  },
);
