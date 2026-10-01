import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Schema/constraint regression tests (Task 2.4).
 *
 * These lock in the critical DDL guarantees of the committed initial migration
 * WITHOUT needing a live database: the migration SQL is the source of truth for
 * what the database enforces, so asserting its content is a deterministic way
 * to guard the schema against accidental regression.
 *
 * Requirements locked in:
 *  - 1.2: case-insensitive email uniqueness (UNIQUE index on users.emailCi).
 *  - 8.3: per-user case-insensitive category uniqueness (UNIQUE on
 *    categories(userId, nameCi)).
 *  - 8.7: a category referenced by expenses cannot be deleted
 *    (expenses.categoryId FK is ON DELETE RESTRICT).
 *  - Budget→Category SET NULL decision (budgets.categoryId FK ON DELETE SET NULL).
 *  - 4.1/6.1/9.1/11.5: two-decimal money precision (Decimal(12,2)).
 *  - performance indexes for list/filter/analytics queries.
 *  - BudgetPeriod enum values.
 */
describe('initial migration DDL (Req 1.2, 8.3, 8.7, money precision, indexes)', () => {
  const migrationPath = join(
    __dirname,
    '..',
    '..',
    'prisma',
    'migrations',
    '20240101000000_init',
    'migration.sql',
  );
  const sql = readFileSync(migrationPath, 'utf8');
  // Whitespace-normalized copy so multi-line FK statements match regardless of
  // formatting.
  const flat = sql.replace(/\s+/g, ' ');

  it('creates the BudgetPeriod enum with weekly/monthly/yearly (Req 9.1)', () => {
    expect(flat).toMatch(
      /CREATE TYPE "public"\."BudgetPeriod" AS ENUM \('weekly', 'monthly', 'yearly'\)/,
    );
  });

  it('enforces case-insensitive email uniqueness on users.emailCi (Req 1.2)', () => {
    expect(flat).toMatch(
      /CREATE UNIQUE INDEX "users_emailCi_key" ON "public"\."users"\("emailCi"\)/,
    );
  });

  it('enforces per-user case-insensitive category uniqueness (Req 8.3)', () => {
    expect(flat).toMatch(
      /CREATE UNIQUE INDEX "categories_userId_nameCi_key" ON "public"\."categories"\("userId", "nameCi"\)/,
    );
  });

  it('restricts deleting a category referenced by expenses (Req 8.7)', () => {
    // expenses.categoryId FK must be ON DELETE RESTRICT.
    expect(flat).toMatch(
      /ALTER TABLE "public"\."expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY \("categoryId"\) REFERENCES "public"\."categories"\("id"\) ON DELETE RESTRICT/,
    );
  });

  it('nulls a budget scope when its category is deleted (Budget→Category SET NULL)', () => {
    expect(flat).toMatch(
      /ALTER TABLE "public"\."budgets" ADD CONSTRAINT "budgets_categoryId_fkey" FOREIGN KEY \("categoryId"\) REFERENCES "public"\."categories"\("id"\) ON DELETE SET NULL/,
    );
  });

  it('cascades user-owned data on user deletion', () => {
    for (const table of ['categories', 'expenses', 'budgets']) {
      expect(flat).toMatch(
        new RegExp(
          `ALTER TABLE "public"\\."${table}" ADD CONSTRAINT "${table}_userId_fkey" FOREIGN KEY \\("userId"\\) REFERENCES "public"\\."users"\\("id"\\) ON DELETE CASCADE`,
        ),
      );
    }
  });

  it('stores money as Decimal(12,2) for exact two-decimal arithmetic (Req 4.1, 9.1, 11.5)', () => {
    expect(flat).toMatch(/"amount" DECIMAL\(12,2\) NOT NULL/);
    expect(flat).toMatch(/"limitAmount" DECIMAL\(12,2\) NOT NULL/);
  });

  it('declares the performance indexes for list/filter/analytics queries', () => {
    // Expense list ordering + monthly range (Req 5.2, 5.3, 11.1).
    expect(flat).toMatch(
      /CREATE INDEX "expenses_userId_date_idx" ON "public"\."expenses"\("userId", "date"\)/,
    );
    // Category filter + by-category insight (Req 5.4, 11.2).
    expect(flat).toMatch(
      /CREATE INDEX "expenses_userId_categoryId_idx" ON "public"\."expenses"\("userId", "categoryId"\)/,
    );
    // Owner-scoped budget listing (Req 9.6).
    expect(flat).toMatch(
      /CREATE INDEX "budgets_userId_idx" ON "public"\."budgets"\("userId"\)/,
    );
    // Owner-scoped category listing (Req 8.4).
    expect(flat).toMatch(
      /CREATE INDEX "categories_userId_idx" ON "public"\."categories"\("userId"\)/,
    );
  });

  it('persists the login-attempt/lockout table keyed by email (Req 2.7)', () => {
    expect(flat).toMatch(/CREATE TABLE "public"\."login_attempts"/);
    expect(flat).toMatch(
      /CONSTRAINT "login_attempts_pkey" PRIMARY KEY \("email"\)/,
    );
  });
});
