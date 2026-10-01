import { execFileSync } from 'node:child_process';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
// NOTE: `AppModule`, `configureApp`, and the `PrismaService` *value* are
// deliberately NOT imported at the top level. Importing `AppModule` eagerly
// loads `ConfigModule`, whose `ConfigModule.forRoot({ validate: validateEnv })`
// runs `validateEnv(process.env)` at module-evaluation time. With no test
// database, `DATABASE_URL`/`JWT_SECRET` are unset, so `validateEnv` THROWS as
// soon as this file is imported — crashing the Jest worker BEFORE
// `describe.skip` can take effect, and reporting the suite as FAILED instead of
// SKIPPED. To keep this file import-safe, those modules are loaded lazily via
// `await import(...)` inside `beforeAll`, AFTER the required `process.env.*`
// keys are set (so validation passes). The type-only import below is erased at
// compile time and does NOT trigger module evaluation.
import type { PrismaService as PrismaServiceType } from '../../src/prisma/prisma.service';

/**
 * End-to-end / integration suite (Req 17.3, 17.4, 17.5).
 *
 * DB-GATED. A real `AppModule` (config → Prisma → all feature modules) is
 * bootstrapped through `configureApp()` and driven over Supertest end-to-end,
 * so this suite is SKIPPED unless `DATABASE_TEST_URL` is set. Placed under
 * `test/e2e/*.spec.ts` so the SINGLE documented `npm test` command runs it
 * (Req 17.1); with no database it skips cleanly.
 *
 * To run the full DB-backed suite locally:
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
 *   DATABASE_TEST_URL="postgresql://postgres:postgres@localhost:5432/expense_test" npm test
 *
 * Coverage (at least one test per functional area, Req 17.3):
 *  - authentication: register + login (real Bearer token used throughout);
 *  - expense create / read (get + list) / update / delete;
 *  - category management (create / list / rename / delete);
 *  - budget tracking (create + GET /:id/status);
 *  - analytics (monthly + by-category).
 * Plus cross-user data-isolation (Req 17.4) and the analytics sum-invariant to
 * a 0.01 tolerance (Req 17.5).
 */
const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const describeDb = DATABASE_TEST_URL ? describe : describe.skip;

describeDb('App e2e (Req 17.3, 17.4, 17.5)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let http: ReturnType<typeof request>;

  // A password satisfying the registration policy (upper/lower/digit/special).
  const PASSWORD = 'Str0ng!Pass';

  beforeAll(async () => {
    // Apply the committed migrations to the test database non-interactively.
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: DATABASE_TEST_URL },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    // Point the app's config at the test DB and provide the other required
    // env keys so ConfigModule's fail-fast validation passes.
    process.env.DATABASE_URL = DATABASE_TEST_URL;
    process.env.RUNTIME_ENV = process.env.RUNTIME_ENV ?? 'local';
    process.env.PORT = process.env.PORT ?? '3000';
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'e2e-test-jwt-secret';
    process.env.PLATFORM_TIMEZONE = process.env.PLATFORM_TIMEZONE ?? 'UTC';

    // Defer these imports until AFTER the env keys above are set, so
    // ConfigModule's fail-fast validation (validateEnv) passes at load time.
    const { AppModule } = await import('../../src/app.module');
    const { configureApp } = await import('../../src/config/configure-app');
    const { PrismaService } = await import('../../src/prisma/prisma.service');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get<PrismaServiceType>(PrismaService);
    http = request(app.getHttpServer() as Server);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(async () => {
    // Clean slate respecting FK order.
    await prisma.budget.deleteMany();
    await prisma.expense.deleteMany();
    await prisma.category.deleteMany();
    await prisma.user.deleteMany();
    await prisma.loginAttempt.deleteMany();
  });

  // ------------------------------------------------------------------ helpers

  /** Registers a user and returns a Bearer token obtained via the real login. */
  const registerAndLogin = async (
    email: string,
  ): Promise<{ token: string; auth: string }> => {
    const reg = await http
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD });
    expect(reg.status).toBe(201);

    const login = await http
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.tokenType).toBe('Bearer');
    expect(login.body.expiresIn).toBe(3600);
    const token = login.body.accessToken as string;
    return { token, auth: `Bearer ${token}` };
  };

  const createCategory = async (
    auth: string,
    name: string,
  ): Promise<string> => {
    const res = await http
      .post('/api/v1/categories')
      .set('Authorization', auth)
      .send({ name });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };

  const createExpense = async (
    auth: string,
    categoryId: string,
    amount: string,
    date: string,
    description?: string,
  ): Promise<string> => {
    const res = await http
      .post('/api/v1/expenses')
      .set('Authorization', auth)
      .send({ amount, currency: 'USD', date, categoryId, description });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };

  // --------------------------------------------------------------- auth (17.3)

  it('authentication: registers a user and issues a working Bearer token', async () => {
    const { auth } = await registerAndLogin('ada@example.com');
    // The token authorizes a protected route.
    const list = await http
      .get('/api/v1/categories')
      .set('Authorization', auth);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
  });

  it('authentication: a protected route without a token is rejected (401 AUTH_REQUIRED)', async () => {
    const res = await http.get('/api/v1/categories');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  // ------------------------------------------------------- expense CRUD (17.3)

  it('expense create + read (get & list): round-trips through real HTTP', async () => {
    const { auth } = await registerAndLogin('owner@example.com');
    const categoryId = await createCategory(auth, 'Groceries');
    const id = await createExpense(
      auth,
      categoryId,
      '42.50',
      '2024-01-15',
      'Weekly run',
    );

    const get = await http
      .get(`/api/v1/expenses/${id}`)
      .set('Authorization', auth);
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({
      id,
      categoryId,
      amount: '42.50',
      currency: 'USD',
      date: '2024-01-15',
      description: 'Weekly run',
    });

    const list = await http.get('/api/v1/expenses').set('Authorization', auth);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(id);
    expect(list.body.meta.pagination.total).toBe(1);
  });

  it('expense update: applies changes and reflects them on read', async () => {
    const { auth } = await registerAndLogin('owner@example.com');
    const categoryId = await createCategory(auth, 'Groceries');
    const id = await createExpense(auth, categoryId, '10.00', '2024-01-10');

    const upd = await http
      .patch(`/api/v1/expenses/${id}`)
      .set('Authorization', auth)
      .send({ amount: '99.99', description: 'corrected' });
    expect(upd.status).toBe(200);
    expect(upd.body.amount).toBe('99.99');

    const get = await http
      .get(`/api/v1/expenses/${id}`)
      .set('Authorization', auth);
    expect(get.body.amount).toBe('99.99');
    expect(get.body.description).toBe('corrected');
  });

  it('expense delete: removes the expense; a later read is 404', async () => {
    const { auth } = await registerAndLogin('owner@example.com');
    const categoryId = await createCategory(auth, 'Groceries');
    const id = await createExpense(auth, categoryId, '10.00', '2024-01-10');

    const del = await http
      .delete(`/api/v1/expenses/${id}`)
      .set('Authorization', auth);
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ deleted: true, id });

    const get = await http
      .get(`/api/v1/expenses/${id}`)
      .set('Authorization', auth);
    expect(get.status).toBe(404);
    expect(get.body.error.code).toBe('NOT_FOUND');
  });

  // ------------------------------------------------- category management (17.3)

  it('category management: create, list, rename, delete', async () => {
    const { auth } = await registerAndLogin('owner@example.com');
    const id = await createCategory(auth, 'Utilities');

    const list = await http
      .get('/api/v1/categories')
      .set('Authorization', auth);
    expect(list.body.map((c: { name: string }) => c.name)).toContain(
      'Utilities',
    );

    const rename = await http
      .patch(`/api/v1/categories/${id}`)
      .set('Authorization', auth)
      .send({ name: 'Bills' });
    expect(rename.status).toBe(200);
    expect(rename.body.name).toBe('Bills');

    const del = await http
      .delete(`/api/v1/categories/${id}`)
      .set('Authorization', auth);
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ deleted: true, id });
  });

  it('category management: deletion is blocked (409 CONFLICT) while referenced by an expense', async () => {
    const { auth } = await registerAndLogin('owner@example.com');
    const categoryId = await createCategory(auth, 'Rent');
    await createExpense(auth, categoryId, '1000.00', '2024-01-05');

    const del = await http
      .delete(`/api/v1/categories/${categoryId}`)
      .set('Authorization', auth);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('CONFLICT');
  });

  // -------------------------------------------------- budget tracking (17.3)

  it('budget tracking: create a budget and compute its status', async () => {
    const { auth } = await registerAndLogin('owner@example.com');
    const categoryId = await createCategory(auth, 'Dining');

    const create = await http
      .post('/api/v1/budgets')
      .set('Authorization', auth)
      .send({ limitAmount: '500.00', period: 'monthly', categoryId });
    expect(create.status).toBe(201);
    const budgetId = create.body.id as string;

    // Two in-scope expenses dated in the current month so they fall in-window.
    const today = new Date();
    const ymd = `${today.getUTCFullYear()}-${(today.getUTCMonth() + 1)
      .toString()
      .padStart(2, '0')}-01`;
    await createExpense(auth, categoryId, '120.00', ymd);
    await createExpense(auth, categoryId, '80.00', ymd);

    const status = await http
      .get(`/api/v1/budgets/${budgetId}/status`)
      .set('Authorization', auth);
    expect(status.status).toBe(200);
    expect(status.body.limit).toBe('500.00');
    expect(status.body.total).toBe('200.00');
    expect(status.body.remaining).toBe('300.00');
    expect(status.body.status).toBe('within_limit');
  });

  // ------------------------------------------------------- analytics (17.3, 17.5)

  it('analytics: monthly total equals the arithmetic sum (tolerance 0.01, Req 17.5)', async () => {
    const { auth } = await registerAndLogin('owner@example.com');
    const categoryId = await createCategory(auth, 'Misc');

    const amounts = ['12.34', '56.78', '90.12', '0.01', '1000.00'];
    for (const a of amounts) {
      await createExpense(auth, categoryId, a, '2024-03-15');
    }
    const expected = amounts.reduce((s, a) => s + Number(a), 0);

    const res = await http
      .get('/api/v1/analytics/monthly')
      .query({ month: '2024-03' })
      .set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.month).toBe('2024-03');
    expect(Math.abs(Number(res.body.total) - expected)).toBeLessThanOrEqual(
      0.01,
    );
  });

  it('analytics: by-category totals equal the per-category arithmetic sums (tolerance 0.01, Req 17.5)', async () => {
    const { auth } = await registerAndLogin('owner@example.com');
    const catA = await createCategory(auth, 'Food');
    const catB = await createCategory(auth, 'Travel');

    const foodAmounts = ['10.00', '20.50'];
    const travelAmounts = ['100.25', '5.75', '0.01'];
    for (const a of foodAmounts) {
      await createExpense(auth, catA, a, '2024-04-10');
    }
    for (const a of travelAmounts) {
      await createExpense(auth, catB, a, '2024-04-20');
    }

    const res = await http
      .get('/api/v1/analytics/by-category')
      .query({ startDate: '2024-04-01', endDate: '2024-04-30' })
      .set('Authorization', auth);
    expect(res.status).toBe(200);

    const byId = new Map<string, number>(
      (res.body.categories as { categoryId: string; total: string }[]).map(
        (c) => [c.categoryId, Number(c.total)],
      ),
    );
    const expectedFood = foodAmounts.reduce((s, a) => s + Number(a), 0);
    const expectedTravel = travelAmounts.reduce((s, a) => s + Number(a), 0);
    expect(Math.abs((byId.get(catA) ?? 0) - expectedFood)).toBeLessThanOrEqual(
      0.01,
    );
    expect(
      Math.abs((byId.get(catB) ?? 0) - expectedTravel),
    ).toBeLessThanOrEqual(0.01);
  });

  // ------------------------------------------- cross-user data isolation (17.4)

  it('data isolation: user B cannot read/update/delete user A resources by id (404), and sees none of A rows', async () => {
    const a = await registerAndLogin('alice@example.com');
    const b = await registerAndLogin('bob@example.com');

    // A creates a category, an expense, and a budget.
    const aCategory = await createCategory(a.auth, 'A-Category');
    const aExpense = await createExpense(
      a.auth,
      aCategory,
      '77.00',
      '2024-02-02',
      'A-secret',
    );
    const aBudget = await http
      .post('/api/v1/budgets')
      .set('Authorization', a.auth)
      .send({ limitAmount: '300.00', period: 'monthly' });
    expect(aBudget.status).toBe(201);
    const aBudgetId = aBudget.body.id as string;

    // B: single-resource access to A's resources → 404 NOT_FOUND, no data.
    const bGetExpense = await http
      .get(`/api/v1/expenses/${aExpense}`)
      .set('Authorization', b.auth);
    expect(bGetExpense.status).toBe(404);
    expect(bGetExpense.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(bGetExpense.body)).not.toContain('A-secret');
    expect(JSON.stringify(bGetExpense.body)).not.toContain('77.00');

    const bPatchExpense = await http
      .patch(`/api/v1/expenses/${aExpense}`)
      .set('Authorization', b.auth)
      .send({ amount: '1.00' });
    expect(bPatchExpense.status).toBe(404);

    const bDeleteExpense = await http
      .delete(`/api/v1/expenses/${aExpense}`)
      .set('Authorization', b.auth);
    expect(bDeleteExpense.status).toBe(404);

    const bRenameCat = await http
      .patch(`/api/v1/categories/${aCategory}`)
      .set('Authorization', b.auth)
      .send({ name: 'hijacked' });
    expect(bRenameCat.status).toBe(404);

    const bBudgetStatus = await http
      .get(`/api/v1/budgets/${aBudgetId}/status`)
      .set('Authorization', b.auth);
    expect(bBudgetStatus.status).toBe(404);

    // B's collections contain NONE of A's rows.
    const bExpenses = await http
      .get('/api/v1/expenses')
      .set('Authorization', b.auth);
    expect(bExpenses.body.data).toHaveLength(0);
    expect(bExpenses.body.meta.pagination.total).toBe(0);

    const bCategories = await http
      .get('/api/v1/categories')
      .set('Authorization', b.auth);
    expect(bCategories.body).toHaveLength(0);

    const bBudgets = await http
      .get('/api/v1/budgets')
      .set('Authorization', b.auth);
    expect(bBudgets.body).toHaveLength(0);

    // A's resource is unchanged after B's failed attempts.
    const aGet = await http
      .get(`/api/v1/expenses/${aExpense}`)
      .set('Authorization', a.auth);
    expect(aGet.status).toBe(200);
    expect(aGet.body.amount).toBe('77.00');
    expect(aGet.body.description).toBe('A-secret');
  });

  // --------------------------------------------------- API documentation (18.5)

  it('unknown endpoint: a request for a route that does not exist returns the no-documentation 404 envelope (Req 18.5)', async () => {
    // A consumer asking for an endpoint the Platform does not expose (and thus
    // has no documentation for) receives the consistent NOT_FOUND envelope,
    // indicating no documentation/handler is available for the requested route.
    const res = await http.get('/api/v1/this-endpoint-does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
    // The known documented docs surface, by contrast, is served (Req 18.1).
    const docs = await http.get('/api/v1/docs');
    expect(docs.status).toBe(200);
  });
});
