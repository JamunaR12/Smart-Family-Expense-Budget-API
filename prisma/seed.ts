/**
 * Deterministic seed data for local development and tests (task 2.3, Req 16.4).
 *
 * Idempotent: every record is written with `upsert` on a stable unique key
 * (User.emailCi, Category (userId, nameCi), Budget/Expense by deterministic id),
 * so running the seed repeatedly converges to the same state without
 * duplicating rows.
 *
 * Run with: `npm run db:seed` (or `prisma db seed`). It only performs work when
 * a database is actually reachable; with no DB available it exits with a clear
 * message rather than hanging.
 *
 * SAFETY: the seed refuses to run when RUNTIME_ENV=aws unless SEED_FORCE=true,
 * to avoid accidentally writing demo data into a shared/production database.
 */
import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Fixed demo credentials — for LOCAL DEVELOPMENT ONLY. */
const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'DemoPass123!'; // meets Req 1.4 policy (upper/lower/digit/special, 8-128).

/** Deterministic UUIDs so re-running the seed targets the same rows. */
const IDS = {
  user: '00000000-0000-4000-8000-000000000001',
  categoryGroceries: '00000000-0000-4000-8000-000000000010',
  categoryUtilities: '00000000-0000-4000-8000-000000000011',
  expense1: '00000000-0000-4000-8000-000000000020',
  expense2: '00000000-0000-4000-8000-000000000021',
  expense3: '00000000-0000-4000-8000-000000000022',
  budget: '00000000-0000-4000-8000-000000000030',
} as const;

async function main(): Promise<void> {
  if (process.env.RUNTIME_ENV === 'aws' && process.env.SEED_FORCE !== 'true') {
    console.warn(
      '[seed] Refusing to seed with RUNTIME_ENV=aws. Set SEED_FORCE=true to override.',
    );
    return;
  }

  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
  });

  const emailCi = DEMO_EMAIL.toLowerCase();

  // Demo user (idempotent on emailCi). Password is only (re)written on create
  // so re-seeding does not churn the hash.
  const user = await prisma.user.upsert({
    where: { emailCi },
    update: {},
    create: {
      id: IDS.user,
      email: DEMO_EMAIL,
      emailCi,
      passwordHash,
    },
  });

  // Categories (idempotent on the (userId, nameCi) unique key).
  const groceries = await prisma.category.upsert({
    where: { userId_nameCi: { userId: user.id, nameCi: 'groceries' } },
    update: {},
    create: {
      id: IDS.categoryGroceries,
      userId: user.id,
      name: 'Groceries',
      nameCi: 'groceries',
    },
  });

  const utilities = await prisma.category.upsert({
    where: { userId_nameCi: { userId: user.id, nameCi: 'utilities' } },
    update: {},
    create: {
      id: IDS.categoryUtilities,
      userId: user.id,
      name: 'Utilities',
      nameCi: 'utilities',
    },
  });

  // Expenses across categories and dates (idempotent on deterministic ids).
  await prisma.expense.upsert({
    where: { id: IDS.expense1 },
    update: {},
    create: {
      id: IDS.expense1,
      userId: user.id,
      categoryId: groceries.id,
      amount: '42.50',
      currency: 'USD',
      date: new Date('2024-01-05'),
      description: 'Weekly grocery run',
    },
  });

  await prisma.expense.upsert({
    where: { id: IDS.expense2 },
    update: {},
    create: {
      id: IDS.expense2,
      userId: user.id,
      categoryId: groceries.id,
      amount: '18.99',
      currency: 'USD',
      date: new Date('2024-01-12'),
      description: 'Snacks',
    },
  });

  await prisma.expense.upsert({
    where: { id: IDS.expense3 },
    update: {},
    create: {
      id: IDS.expense3,
      userId: user.id,
      categoryId: utilities.id,
      amount: '120.00',
      currency: 'USD',
      date: new Date('2024-01-20'),
      description: 'Electricity bill',
    },
  });

  // A monthly budget scoped to Groceries (idempotent on deterministic id).
  await prisma.budget.upsert({
    where: { id: IDS.budget },
    update: {},
    create: {
      id: IDS.budget,
      userId: user.id,
      categoryId: groceries.id,
      limitAmount: '300.00',
      period: 'monthly',
    },
  });

  console.log(
    `[seed] Seeded demo user "${DEMO_EMAIL}" (password: ${DEMO_PASSWORD}) with 2 categories, 3 expenses, 1 budget.`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('[seed] Seeding failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
