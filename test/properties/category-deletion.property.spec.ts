import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import * as fc from 'fast-check';
import {
  CategoriesService,
  CONFLICT_CODE,
} from '../../src/categories/categories.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * // Feature: smart-expense-insights-platform, Property 23
 *
 * Property 23: Category deletion respects expense references (Req 8.7, 8.8).
 *
 * DB-GATED. Skipped unless DATABASE_TEST_URL is set. For an owned category:
 *  - when one or more of the user's expenses reference it, deletion is
 *    rejected with a 409 CONFLICT and the category is RETAINED (Req 8.7);
 *  - when no expenses reference it, deletion SUCCEEDS returning
 *    `{ deleted: true, id }` and the category is removed (Req 8.8).
 */
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeDb = DATABASE_TEST_URL ? describe : describe.skip;

describeDb(
  'Property 23 (DB) — category deletion vs references (Req 8.7, 8.8)',
  () => {
    let prisma: PrismaClient;
    let service: CategoriesService;

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
      service = new CategoriesService(prisma as unknown as PrismaService);
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

    const newOwner = () =>
      prisma.user.create({
        data: {
          email: 'Owner@Example.com',
          emailCi: 'owner@example.com',
          passwordHash: 'hash',
        },
      });

    it('rejects deletion (409 CONFLICT) while referenced, retaining the category', async () => {
      // Seed the category with an arbitrary positive number of referencing
      // expenses; deletion must always be refused and the row retained.
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (refCount) => {
          await prisma.expense.deleteMany();
          await prisma.category.deleteMany();
          await prisma.user.deleteMany();
          const owner = await newOwner();

          const category = await prisma.category.create({
            data: { userId: owner.id, name: 'Food', nameCi: 'food' },
          });

          for (let i = 0; i < refCount; i++) {
            await prisma.expense.create({
              data: {
                userId: owner.id,
                categoryId: category.id,
                amount: '10.00',
                currency: 'USD',
                date: new Date('2024-03-15T00:00:00.000Z'),
              },
            });
          }

          await expect(
            service.remove(owner.id, category.id),
          ).rejects.toMatchObject({ response: { code: CONFLICT_CODE } });

          // The category is retained.
          const still = await prisma.category.findUnique({
            where: { id: category.id },
          });
          expect(still).not.toBeNull();
        }),
        { numRuns: 100 },
      );
    });

    it('succeeds when unreferenced, removing the category', async () => {
      // An arbitrary number of the user's OTHER-category expenses must not
      // block deletion of an unreferenced category.
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 0, max: 5 }), async (otherCount) => {
          await prisma.expense.deleteMany();
          await prisma.category.deleteMany();
          await prisma.user.deleteMany();
          const owner = await newOwner();

          const target = await prisma.category.create({
            data: { userId: owner.id, name: 'Unused', nameCi: 'unused' },
          });
          const other = await prisma.category.create({
            data: { userId: owner.id, name: 'Other', nameCi: 'other' },
          });

          for (let i = 0; i < otherCount; i++) {
            await prisma.expense.create({
              data: {
                userId: owner.id,
                categoryId: other.id,
                amount: '5.00',
                currency: 'USD',
                date: new Date('2024-03-15T00:00:00.000Z'),
              },
            });
          }

          const result = await service.remove(owner.id, target.id);
          expect(result).toEqual({ deleted: true, id: target.id });

          const gone = await prisma.category.findUnique({
            where: { id: target.id },
          });
          expect(gone).toBeNull();
        }),
        { numRuns: 100 },
      );
    });
  },
);
