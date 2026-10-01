import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import * as fc from 'fast-check';
import { CreateCategoryDto } from '../../src/categories/dto/create-category.dto';
import {
  CategoriesService,
  CATEGORY_NAME_MAX,
  CONFLICT_CODE,
  VALIDATION_ERROR_CODE,
} from '../../src/categories/categories.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * // Feature: smart-expense-insights-platform, Property 22
 *
 * Property 22: Category name normalization and uniqueness
 * (Req 8.1, 8.2, 8.3, 8.5).
 *
 * This file is split into a PURE part (always runs) and a DB-GATED part
 * (skipped without DATABASE_TEST_URL):
 *
 *  - PURE: the DTO contract that the global `ValidationPipe` enforces before
 *    the service — `name` must be a non-empty string. Arbitrary
 *    empty/whitespace / non-string names FAIL naming `name`; arbitrary valid
 *    strings PASS the DTO (the authoritative trim + 1-100 length + uniqueness
 *    rules live in the SERVICE and are exercised in the DB-gated block).
 *  - DB-GATED: the SERVICE-side normalization + uniqueness rules that need a
 *    real row — a trimmed 1-100 name is accepted; an all-whitespace / >100
 *    name is rejected (400 VALIDATION_ERROR naming `name`) with no category
 *    created; a case/trim-variant of an existing name is a 409 CONFLICT with
 *    no second category created; a no-op case-preserving rename of the SAME
 *    category is allowed.
 */

// ---------------------------------------------------------------------------
// PURE — DTO field validation (always runs, no database).
// ---------------------------------------------------------------------------
describe('Property 22 (pure) — category DTO field validation (Req 8.1, 8.2)', () => {
  const failingFields = async (
    payload: Record<string, unknown>,
  ): Promise<string[]> => {
    const dto = plainToInstance(CreateCategoryDto, payload);
    const errors: ValidationError[] = await validate(dto);
    return errors.map((e) => e.property);
  };

  it('accepts arbitrary non-empty string names at the DTO layer', async () => {
    // The DTO only guarantees a non-empty string within a generous bound; the
    // trim/length/uniqueness rules are the service's responsibility.
    const okArb = fc
      .string({ minLength: 1, maxLength: 100 })
      .filter((s) => s.trim().length >= 1);

    await fc.assert(
      fc.asyncProperty(okArb, async (name) => {
        expect(await failingFields({ name })).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects an empty or non-string name naming name', async () => {
    // Values that violate the DTO's @IsNotEmpty/@IsString on `name`. Selected
    // by index to keep the arbitrary typed as `unknown` without spreading a
    // mixed-type tuple into `constantFrom` (which eslint flags as unsafe).
    const invalidValues: unknown[] = ['', undefined, null, 42, true, {}, []];
    const invalidArb: fc.Arbitrary<unknown> = fc
      .integer({ min: 0, max: invalidValues.length - 1 })
      .map((i) => invalidValues[i]);

    await fc.assert(
      fc.asyncProperty(invalidArb, async (name) => {
        const fields = await failingFields({ name });
        expect(fields).toContain('name');
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// DB-GATED — service-level normalization + uniqueness (skipped without a DB).
// ---------------------------------------------------------------------------
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeDb = DATABASE_TEST_URL ? describe : describe.skip;

describeDb(
  'Property 22 (DB) — service name trim/length/uniqueness (Req 8.1, 8.2, 8.3, 8.5)',
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

    // 0-4 characters of surrounding whitespace (typed as string to avoid the
    // unsafe-argument quirk of stringOf(constantFrom(...))).
    const whitespaceArb: fc.Arbitrary<string> = fc
      .array(fc.constantFrom(' ', '\t', '\n'), { maxLength: 4 })
      .map((chars) => chars.join(''));

    // A "core" 1-100 char name with at least one non-whitespace character,
    // padded with random surrounding whitespace to exercise trimming.
    const paddedValidNameArb = fc
      .tuple(
        fc
          .string({ minLength: 1, maxLength: 100 })
          .filter((s) => s.trim().length >= 1 && s.trim().length <= 100)
          .map((s) => s.trim()),
        whitespaceArb,
        whitespaceArb,
      )
      .map(([core, left, right]) => ({
        core,
        padded: `${left}${core}${right}`,
      }));

    it('accepts a trimmed 1-100 name and stores the trimmed value', async () => {
      await fc.assert(
        fc.asyncProperty(paddedValidNameArb, async ({ core, padded }) => {
          await prisma.category.deleteMany();
          await prisma.user.deleteMany();
          const owner = await newOwner();

          const created = await service.create(owner.id, { name: padded });
          expect(created.name).toBe(core);

          const rows = await prisma.category.findMany({
            where: { userId: owner.id },
          });
          expect(rows).toHaveLength(1);
          expect(rows[0].name).toBe(core);
          expect(rows[0].nameCi).toBe(core.toLowerCase());
        }),
        { numRuns: 100 },
      );
    });

    it('rejects all-whitespace / >100-char names (400 VALIDATION_ERROR) without creating', async () => {
      const allWhitespaceArb = fc
        .array(fc.constantFrom(' ', '\t', '\n'), { minLength: 1, maxLength: 8 })
        .map((chars) => chars.join(''));
      const invalidNameArb = fc.oneof(
        // All-whitespace → empty after trim.
        allWhitespaceArb,
        // Longer than 100 after trim.
        fc
          .integer({ min: CATEGORY_NAME_MAX + 1, max: CATEGORY_NAME_MAX + 50 })
          .map((n) => 'x'.repeat(n)),
      );

      await fc.assert(
        fc.asyncProperty(invalidNameArb, async (name) => {
          await prisma.category.deleteMany();
          await prisma.user.deleteMany();
          const owner = await newOwner();

          await expect(
            service.create(owner.id, { name }),
          ).rejects.toMatchObject({
            response: {
              code: VALIDATION_ERROR_CODE,
              details: [{ field: 'name' }],
            },
          });

          expect(await prisma.category.count()).toBe(0);
        }),
        { numRuns: 100 },
      );
    });

    it('rejects a case/trim-variant of an existing name (409 CONFLICT), creating no second category', async () => {
      const baseNameArb = fc
        .string({ minLength: 1, maxLength: 60 })
        .filter((s) => s.trim().length >= 1)
        .map((s) => s.trim());

      await fc.assert(
        fc.asyncProperty(baseNameArb, async (base) => {
          await prisma.category.deleteMany();
          await prisma.user.deleteMany();
          const owner = await newOwner();

          await service.create(owner.id, { name: base });

          // A case-swapped, whitespace-padded variant collides.
          const variant = `  ${swapCase(base)}  `;
          await expect(
            service.create(owner.id, { name: variant }),
          ).rejects.toMatchObject({
            response: { code: CONFLICT_CODE },
          });

          // Only the original remains.
          const rows = await prisma.category.findMany({
            where: { userId: owner.id },
          });
          expect(rows).toHaveLength(1);
        }),
        { numRuns: 100 },
      );
    });

    it('allows a no-op case-preserving rename of the same category', async () => {
      const owner = await newOwner();
      const created = await service.create(owner.id, { name: 'Groceries' });

      // Renaming the category to (a padded variant of) its own name is allowed
      // because the uniqueness check excludes the category itself (Req 8.5).
      const updated = await service.update(owner.id, created.id, {
        name: '  Groceries  ',
      });
      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe('Groceries');

      expect(await prisma.category.count()).toBe(1);
    });
  },
);

/** Swaps the case of ASCII letters; leaves other characters untouched. */
function swapCase(s: string): string {
  return s.replace(/[a-zA-Z]/g, (c) =>
    c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase(),
  );
}
