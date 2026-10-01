# Smart Expense Insights Platform API

A production-quality expense management API that lets individuals and households
record expenses, organize them by category, set and track budgets, and derive
spending analytics. The platform provides secure authentication and enforces
strict per-user data isolation so each account owner accesses only their own
financial data.

A defining characteristic is **deployment portability**: the same codebase runs
locally as a conventional NestJS + Express HTTP server and deploys to AWS
(API Gateway → Lambda → PostgreSQL/RDS) via AWS SAM, without divergent
application source.

> **Status:** Phase 1 (Project Foundation), Phase 2 (Database & Persistence),
> Phase 3 (Authentication & Authorization), Phase 4 (Expense Management),
> Phase 5 (Categories & Budgets), Phase 6 (Spending Analytics), and Phase 8
> (Security & Production Readiness) are implemented — configuration,
> single-codebase bootstrap, correlation-id middleware, structured logging
> skeleton, API documentation scaffolding, the Prisma data model with
> migrations/seed data and a connection-managed `PrismaService`, secure
> registration/login, JWT issuance, per-email lockout, per-user data isolation
> (see [Authentication & Authorization](#authentication--authorization)), full
> expense CRUD with filtering, ordering, and pagination (see
> [Expense Management](#expense-management)), category management with
> normalization and dependency-guarded deletes (see [Categories](#categories)),
> budget CRUD plus status/tracking (see [Budgets](#budgets)), monthly /
> by-category spending insights (see [Analytics](#analytics)), and the security
> and production-readiness layer — structured request logging with secret
> redaction, environment-driven CORS, a public health/readiness endpoint,
> layered rate-limiting, and config fail-fast (see [Security](#security),
> [Observability / Logging](#observability--logging), and
> [Health check](#health-check)).

## Tech stack

- **Language:** TypeScript (Node.js)
- **Framework:** NestJS on the Express HTTP adapter
- **Database:** PostgreSQL via Prisma (added in Phase 2)
- **Deployment:** AWS Lambda + API Gateway, packaged with AWS SAM
- **Validation:** Zod (environment config), class-validator (request DTOs)
- **Testing:** Jest, Supertest, fast-check (property-based tests)
- **API docs:** OpenAPI / Swagger (`@nestjs/swagger`)

## Prerequisites

- **Node.js** 20+ and npm
- **PostgreSQL** (local instance for development; required from Phase 2 onward)

## Local setup

```bash
# 1. Install dependencies
npm install

# 2. Create your local environment file from the template
cp .env.example .env
# then edit .env and set DATABASE_URL / JWT_SECRET for your machine

# 3. Build (compile TypeScript to dist/)
npm run build
```

### Database (PostgreSQL + Prisma)

The Platform stores data in PostgreSQL and accesses it through Prisma. You need
a reachable PostgreSQL instance from Phase 2 onward.

**Option A — Docker (recommended for a throwaway local database):**

```bash
docker run --rm --name expense-pg \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=expense_dev \
  -p 5432:5432 postgres:16
```

**Option B — a locally installed PostgreSQL**: create a database (e.g.
`expense_dev`) and a user with access to it.

Then point the app at it in `.env`:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/expense_dev?schema=public"
```

Generate the Prisma client, apply the schema, and (optionally) load demo data:

```bash
# Generate the typed Prisma client (safe to run offline; no DB needed)
npm run prisma:generate

# Apply the committed migrations non-interactively (CI / a fresh DB)
npm run prisma:migrate:deploy

# ...or author a new migration while iterating on the schema (local only)
npm run prisma:migrate:dev

# Load deterministic, idempotent seed data
npm run db:seed
```

`npm run db:seed` creates a demo account:

- **email:** `demo@example.com`
- **password:** `DemoPass123!`

along with two categories, three expenses, and one monthly budget. The seed is
idempotent (upserts on stable keys), so re-running it converges to the same
state rather than duplicating rows. It refuses to run when `RUNTIME_ENV=aws`
unless `SEED_FORCE=true`, to avoid writing demo data into a shared database.

### Running the database integration tests

Most of the suite runs with **no database** (see [Testing](#testing)). The
schema-enforcement integration tests are **gated**: they only run when
`DATABASE_TEST_URL` is set, and are skipped otherwise so `npm test` stays green
without a database.

```bash
# Start a throwaway database (see Option A above), then:
DATABASE_TEST_URL="postgresql://postgres:postgres@localhost:5432/expense_test?schema=public" npm test
```

When `DATABASE_TEST_URL` is set, the integration spec applies the committed
migrations with `prisma migrate deploy` against that database and verifies real
persistence and constraints (case-insensitive email uniqueness, per-user
category uniqueness, category delete-restrict, budget `SET NULL`, and Decimal
round-tripping). Use a **dedicated throwaway database** — the tests truncate all
tables between cases.

## Running locally

```bash
# Watch-mode development server (recommended while iterating)
npm run start:dev

# Or run a production-style build
npm run build && npm run start:prod
```

The server starts only when `RUNTIME_ENV` is not `aws`. It listens on the
configured `PORT` (default `3000`). If the port is already in use, startup aborts
with a clear binding error.

## API documentation

Interactive OpenAPI/Swagger documentation is served at:

```
GET /api/v1/docs
```

For example, when running locally on the default port:
`http://localhost:3000/api/v1/docs`. Every API route is served under the
`/api/v1` prefix (global prefix `api` + URI version `1`). Endpoint schemas are
generated from decorators and expand as feature modules are added in later
phases.

## Authentication & Authorization

The Platform issues stateless **JWT Bearer tokens** and enforces strict
per-user data isolation. Both auth endpoints are public (no token required);
every other route requires a valid token.

### Endpoints

All routes are under the `/api/v1` surface.

#### `POST /api/v1/auth/register`

Creates a new account. Request body:

```jsonc
{
  "email": "ada@example.com", // RFC 5322, 3–254 chars, unique (case-insensitive)
  "password": "Str0ng!Pass", // 8–128 chars, see password policy below
}
```

Success — **201 Created** (the created user; the password hash is never
returned):

```jsonc
{
  "id": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "email": "ada@example.com",
  "createdAt": "2024-01-15T09:24:00.000Z",
}
```

Failures:

- **400 `VALIDATION_ERROR`** — the email or password failed validation; the
  response `details[]` names each failing field.
- **409 `CONFLICT`** — an account with this email (compared case-insensitively)
  already exists; no duplicate is created.

#### `POST /api/v1/auth/login`

Verifies credentials and issues a token. Request body:

```jsonc
{ "email": "ada@example.com", "password": "Str0ng!Pass" }
```

Success — **200 OK**:

```jsonc
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "tokenType": "Bearer",
  "expiresIn": 3600,
}
```

Failures:

- **400 `VALIDATION_ERROR`** — a required credential (email or password) is
  missing or empty; verification is not attempted.
- **401 `AUTH_FAILED`** — invalid email **or** password. The error is
  deliberately identical for both cases so it never discloses which field was
  wrong.
- **401 `ACCOUNT_LOCKED`** — the account is temporarily locked after too many
  failed attempts (see [Lockout policy](#lockout-policy)).

### Error response shape

Every failure is returned as the consistent error envelope. The top-level
`success` flag is the explicit success/failure indicator (`false` on errors;
success responses use the 2xx status and return the resource directly):

```jsonc
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR", // machine-readable; see the table below
    "message": "Validation failed", // human-readable, <= 500 chars
    "details": [
      // present only for VALIDATION_ERROR
      { "field": "email", "reason": "email must be a valid email address" },
    ],
  },
  "meta": { "correlationId": "3f2504e0-4f89-41d3-9a0c-0305e82c3301" },
}
```

### Using the token

Present the issued token on every protected request in the standard
`Authorization` header:

```
Authorization: Bearer <accessToken>
```

Tokens are valid for **3600 seconds (1 hour)** from issuance. When a request is
made to a protected route:

- with **no** token → **401 `AUTH_REQUIRED`**;
- with an **expired, malformed, or bad-signature** token → **401 `AUTH_FAILED`**.

> **Known limitation (by design):** tokens are **not revocable before expiry**.
> With a 1-hour lifetime and no refresh/denylist flow in v1, a compromised token
> remains valid until it expires. This is a documented tradeoff (see the design
> §Ambiguities, items 1–2); a denylist or short access + refresh tokens are the
> recommended future enhancement.

### Password policy

Passwords must be **8–128 characters** and contain at least:

- one uppercase letter,
- one lowercase letter,
- one digit, and
- one special (non-alphanumeric) character.

Passwords are stored only as a **salted argon2id hash** with a unique per-user
salt — the plaintext is never stored, returned, or logged (Req 1.5). Two users
who choose the same password get different stored hashes.

### Lockout policy

To resist brute-force attacks, failed logins are tracked per (normalized)
email in a shared `LoginAttempt` table (so lockout behaves consistently across
stateless Lambda containers):

- After **5 consecutive failures within a 15-minute window**, the account is
  **locked for 900 seconds (15 minutes)**.
- While locked, even a request with the correct password is refused with
  **`ACCOUNT_LOCKED`**.
- A successful login (before the threshold) resets the consecutive-failure
  counter.

These thresholds are configurable via `LOGIN_MAX_ATTEMPTS`,
`LOGIN_WINDOW_MINUTES`, and `LOGIN_LOCKOUT_SECONDS` (see
[Configuration](#configuration)).

### Per-user data isolation

Every user can access only their own data. Isolation is enforced two ways:

- **Owner-scoped queries** (the primary mechanism): every read and write filters
  by `userId = currentUser.id` (`ownerScope(userId)`), so collections only ever
  contain the caller's records and return `[]` when they own none.
- **`JwtAuthGuard` + `OwnershipGuard`/`assertOwnership()`**: a global
  `JwtAuthGuard` requires a valid token on every route except those marked
  `@Public()` (register, login, docs). For single-resource (`/:id`) routes the
  ownership backstop denies a non-owner **without disclosing whether the
  resource exists** — "not owned" and "not found" both return **404
  `NOT_FOUND`** (Req 3.2). The HTTP-level resource routes that consume these
  primitives arrive in Phases 4–6.

### Auth error codes

| Code               | HTTP | Meaning                                                  |
| ------------------ | ---- | -------------------------------------------------------- |
| `VALIDATION_ERROR` | 400  | Request body/field failed validation (names each field). |
| `AUTH_REQUIRED`    | 401  | Protected route reached with no token.                   |
| `AUTH_FAILED`      | 401  | Bad credentials, or an expired/malformed/invalid token.  |
| `ACCOUNT_LOCKED`   | 401  | Too many failed logins; temporarily locked.              |
| `CONFLICT`         | 409  | Email already registered (case-insensitive).             |
| `NOT_FOUND`        | 404  | Resource missing or not owned (non-disclosing).          |

## Expense Management

Expenses are the core resource. All five endpoints live under `/api/v1/expenses`
and require a valid Bearer token (they are **not** `@Public()`); an
unauthenticated request is rejected with **401** before the handler runs. Every
operation is **owner-scoped** — a request only ever sees or affects rows owned
by the authenticated user (see [Per-user data isolation](#per-user-data-isolation)).

### Endpoints

| Method & path                 | Purpose                         | Success         |
| ----------------------------- | ------------------------------- | --------------- |
| `POST /api/v1/expenses`       | Create an expense               | **201 Created** |
| `GET /api/v1/expenses`        | List expenses (filter/paginate) | **200 OK**      |
| `GET /api/v1/expenses/:id`    | Get one expense                 | **200 OK**      |
| `PATCH /api/v1/expenses/:id`  | Update an expense (partial)     | **200 OK**      |
| `DELETE /api/v1/expenses/:id` | Delete an expense               | **200 OK**      |

### `POST /api/v1/expenses`

Request body:

```jsonc
{
  "amount": "42.50", // decimal string, see rules
  "currency": "USD", // ISO 4217 3-letter code
  "date": "2024-01-15", // YYYY-MM-DD, non-future
  "categoryId": "7c3e0b1a-9d5f-4c2e-8a6b-1f2d3e4a5b6c", // a category you own
  "description": "Weekly grocery run", // optional, <= 500 chars
}
```

Success — **201 Created** returns the created expense (the internal `userId` is
never surfaced):

```jsonc
{
  "id": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "categoryId": "7c3e0b1a-9d5f-4c2e-8a6b-1f2d3e4a5b6c",
  "amount": "42.50",
  "currency": "USD",
  "date": "2024-01-15",
  "description": "Weekly grocery run",
  "createdAt": "2024-01-15T09:24:00.000Z",
  "updatedAt": "2024-01-15T09:24:00.000Z",
}
```

### `GET /api/v1/expenses`

Returns the caller's expenses ordered by **date descending** (`createdAt`
descending as a stable tiebreaker), wrapped with pagination metadata.

Query parameters (all optional):

| Parameter    | Rule                                 | Default |
| ------------ | ------------------------------------ | ------- |
| `startDate`  | `YYYY-MM-DD`, inclusive lower bound  | —       |
| `endDate`    | `YYYY-MM-DD`, inclusive upper bound  | —       |
| `categoryId` | UUID of a category owned by the user | —       |
| `limit`      | integer 1–100                        | `20`    |
| `offset`     | integer ≥ 0                          | `0`     |

The date range is **inclusive on both boundaries** (Req 5.3). The service also
rejects an inverted range where `startDate` is after `endDate`. Response shape:

```jsonc
{
  "data": [
    /* ExpenseResponse[] — empty [] when nothing matches */
  ],
  "meta": {
    "pagination": { "limit": 20, "offset": 0, "total": 57 },
  },
}
```

`total` is the full owner-scoped count matching the filters (independent of the
returned page), so clients can paginate deterministically.

### `GET /api/v1/expenses/:id`, `PATCH /api/v1/expenses/:id`, `DELETE /api/v1/expenses/:id`

- **GET** returns a single owned expense.
- **PATCH** applies a partial update — any subset of `amount`, `currency`,
  `date`, `description`, `categoryId`. Provided fields are validated with the
  same rules as create; **invalid input leaves the stored expense unchanged**
  (Req 6.2–6.4). Omitted fields are untouched.
- **DELETE** removes the expense and returns `{ "deleted": true, "id": "…" }`.

**Not-found vs. authorization semantics (non-disclosing):** a `/:id` that does
not exist and one that exists but belongs to **another user** both return the
**same 404 `NOT_FOUND`**. The API never discloses whether a resource it doesn't
own exists (Req 3.2, 5.8, 6.6, 7.3).

### Validation rules

| Field         | Rule                                                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `amount`      | Decimal **string** in `0.01`–`999,999,999.99` with **at most two decimals**. Zero, negative, non-numeric, over-max, or >2dp → **400 `VALIDATION_ERROR`** naming `amount`.                                                |
| `currency`    | A recognized **ISO 4217** 3-letter code (matched case-insensitively; stored uppercase).                                                                                                                                  |
| `date`        | A valid `YYYY-MM-DD` calendar date **not in the future**. "Today" is evaluated in the configured `PLATFORM_TIMEZONE` (A3).                                                                                               |
| `categoryId`  | A UUID of a category **owned by the caller**. A missing/foreign category is a **400 `VALIDATION_ERROR`** ("category is invalid"), not a 404 — the request references an invalid category rather than an unknown expense. |
| `description` | Optional, **≤ 500 characters**.                                                                                                                                                                                          |

Unknown/extra fields are rejected by the global `ValidationPipe`
(`forbidNonWhitelisted`). No expense is created or modified on any validation
failure.

### Money as a string (`amount`)

`amount` is accepted and returned as a **decimal string** (e.g. `"42.50"`), not
a JSON number. It is stored as PostgreSQL `Decimal(12,2)` and mapped back with
`toFixed(2)`. This preserves exact two-decimal precision and avoids IEEE-754
floating-point drift on the wire (design **ADR-5**), which underpins the
analytics/budget sum invariants added in later phases.

### Expense error codes

| Code                            | HTTP | When                                                                                                            |
| ------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`              | 400  | A field failed validation, or the category is invalid/not owned, or a list parameter is malformed/out of range. |
| `AUTH_REQUIRED` / `AUTH_FAILED` | 401  | Missing or invalid token.                                                                                       |
| `NOT_FOUND`                     | 404  | The expense does not exist **or** is not owned (non-disclosing).                                                |

## Categories

Categories group expenses. All four endpoints live under
`/api/v1/categories` and require a valid Bearer token (they are **not**
`@Public()`); an unauthenticated request is rejected with **401** before the
handler runs. Every operation is **owner-scoped** — a request only ever sees or
affects categories owned by the authenticated user (see
[Per-user data isolation](#per-user-data-isolation)).

### Endpoints

| Method & path                   | Purpose           | Success         |
| ------------------------------- | ----------------- | --------------- |
| `POST /api/v1/categories`       | Create a category | **201 Created** |
| `GET /api/v1/categories`        | List categories   | **200 OK**      |
| `PATCH /api/v1/categories/:id`  | Rename a category | **200 OK**      |
| `DELETE /api/v1/categories/:id` | Delete a category | **200 OK**      |

### `POST /api/v1/categories`

Request body:

```jsonc
{ "name": "Groceries" } // trimmed, then 1–100 chars, unique (case-insensitive)
```

Success — **201 Created** returns the created category (the internal `userId`
and normalized `nameCi` are never surfaced):

```jsonc
{
  "id": "7c3e0b1a-9d5f-4c2e-8a6b-1f2d3e4a5b6c",
  "name": "Groceries",
  "createdAt": "2024-01-15T09:24:00.000Z",
  "updatedAt": "2024-01-15T09:24:00.000Z",
}
```

### `GET /api/v1/categories`

Returns the caller's categories ordered by `name` ascending, or an empty list
`[]` when the user owns none (Req 8.4).

### `PATCH /api/v1/categories/:id`

Renames an owned category. The body is `{ "name": "…" }`, validated with the
same trim + 1–100 char + case-insensitive uniqueness rules as create. The
uniqueness check **excludes the category itself**, so a no-op / case-preserving
rename is allowed (Req 8.5).

### `DELETE /api/v1/categories/:id`

Removes an owned category and returns `{ "deleted": true, "id": "…" }`
(Req 8.8). Deletion is **rejected with a 409 `CONFLICT`** while one or more of
the user's expenses reference the category — the category is retained
(Req 8.7).

### Name rules

| Rule           | Behavior                                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trim**       | Leading/trailing whitespace is stripped before every check. The stored `name` is the trimmed value.                                                                     |
| **Length**     | After trimming, `name` must be **1–100 characters**. Empty/all-whitespace or `>100` → **400 `VALIDATION_ERROR`** naming `name`.                                         |
| **Uniqueness** | **Case-insensitive**, per-user. A case or trim variant of an existing name (e.g. `" groceries "` vs `"Groceries"`) → **409 `CONFLICT`**; no second category is created. |

Normalization (trim), the length rule, and case-insensitive uniqueness are the
**single source of truth in `CategoriesService`** (the DTO only guarantees a
non-empty string within a generous bound), so `" Food "` and `"food"`
consistently collide and an all-whitespace name is consistently rejected as a
field-level error.

**Not-found vs. authorization semantics (non-disclosing):** a `/:id` that does
not exist and one that exists but belongs to **another user** both return the
**same 404 `NOT_FOUND`** — the API never discloses whether a category it does
not own exists (Req 3.2, 8.6).

### Category error codes

| Code                            | HTTP | When                                                                                                                           |
| ------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------ |
| `VALIDATION_ERROR`              | 400  | `name` is empty/whitespace or exceeds 100 chars after trimming.                                                                |
| `AUTH_REQUIRED` / `AUTH_FAILED` | 401  | Missing or invalid token.                                                                                                      |
| `NOT_FOUND`                     | 404  | The category does not exist **or** is not owned (non-disclosing).                                                              |
| `CONFLICT`                      | 409  | A category with this name already exists (case-insensitive), **or** the category is referenced by existing expenses on delete. |

## Budgets

Budgets set a spending limit for a period, optionally scoped to a category. All
endpoints live under `/api/v1/budgets` and require a valid Bearer token; every
operation is **owner-scoped**.

### Endpoints

| Method & path                    | Purpose                   | Success         |
| -------------------------------- | ------------------------- | --------------- |
| `POST /api/v1/budgets`           | Create a budget           | **201 Created** |
| `GET /api/v1/budgets`            | List budgets              | **200 OK**      |
| `GET /api/v1/budgets/:id/status` | Budget status / tracking  | **200 OK**      |
| `PATCH /api/v1/budgets/:id`      | Update a budget (partial) | **200 OK**      |
| `DELETE /api/v1/budgets/:id`     | Delete a budget           | **200 OK**      |

### `POST /api/v1/budgets`

Request body:

```jsonc
{
  "limitAmount": "500.00", // decimal string, see rules
  "period": "monthly", // weekly | monthly | yearly
  "categoryId": "7c3e0b1a-9d5f-4c2e-8a6b-1f2d3e4a5b6c", // optional; a category you own
}
```

Success — **201 Created** returns the created budget (the internal `userId` is
never surfaced; `categoryId` is `null` for an unscoped, all-categories budget):

```jsonc
{
  "id": "b1d2c3e4-5f6a-4b7c-8d9e-0a1b2c3d4e5f",
  "limitAmount": "500.00",
  "period": "monthly",
  "categoryId": "7c3e0b1a-9d5f-4c2e-8a6b-1f2d3e4a5b6c",
  "createdAt": "2024-01-15T09:24:00.000Z",
  "updatedAt": "2024-01-15T09:24:00.000Z",
}
```

### `GET /api/v1/budgets`

Returns the caller's budgets ordered by `createdAt` descending, or `[]` when the
user owns none (Req 9.6).

### `PATCH /api/v1/budgets/:id`, `DELETE /api/v1/budgets/:id`

- **PATCH** applies a partial update — any subset of `limitAmount`, `period`,
  `categoryId`. Provided fields are validated with the same rules as create;
  **invalid input leaves the stored budget unchanged** (Req 9.3–9.5).
- **DELETE** removes the budget and returns `{ "deleted": true, "id": "…" }`.

### Validation rules

| Field         | Rule                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `limitAmount` | Decimal **string** in `0.01`–`999,999,999.99` with **at most two decimals**. Below-min, over-max, non-numeric, or `>2dp` → **400 `VALIDATION_ERROR`** naming `limitAmount`.           |
| `period`      | One of `weekly`, `monthly`, `yearly`. Anything else → **400 `VALIDATION_ERROR`** naming `period`.                                                                                     |
| `categoryId`  | Optional UUID of a category **owned by the caller**. A missing/foreign category is a **400 `VALIDATION_ERROR`** ("category is not accessible"), and no budget is created or modified. |

### `GET /api/v1/budgets/:id/status`

Computes spending against the budget for the **current period window** and
returns:

```jsonc
{
  "budgetId": "b1d2c3e4-5f6a-4b7c-8d9e-0a1b2c3d4e5f",
  "period": "monthly",
  "limit": "500.00", // the budget limit (two-decimal string)
  "total": "320.00", // sum of in-scope, in-period spend
  "remaining": "180.00", // limit − total
  "status": "within_limit", // or "exceeded"
  // "exceeded": "25.00"  // present ONLY when status is "exceeded" (total − limit)
}
```

Semantics (Req 10):

- `total` = the arithmetic sum of the user's **in-scope, in-period** expense
  amounts (0.00 when none). "In scope" means the budget's category when the
  budget is category-scoped, otherwise all of the user's categories.
- `remaining` = `limit − total`.
- `status` is **`within_limit`** while `0 ≤ total ≤ limit` (with
  `remaining ≥ 0`), otherwise **`exceeded`** with `exceeded = total − limit`.
- **Zero-spend** (no in-scope, in-period expenses) → `total` `"0.00"`,
  `remaining` = `limit`, `status` `within_limit` (Req 10.5).

#### Budget period window

The window is derived from the budget's `period` relative to "now", evaluated in
the configured `PLATFORM_TIMEZONE` (A3), at **day granularity** (expense dates
are date-only, so day-level windows avoid timezone-shift ambiguity):

- **weekly** — **Monday..Sunday** of the week containing the reference day
  (**ISO-8601 week start**; see the note below).
- **monthly** — the **1st..last day** of the reference calendar month
  (leap-aware, e.g. February 2024 → the 29th).
- **yearly** — **Jan 1..Dec 31** of the reference calendar year.

Both bounds are **inclusive**. The reference "now" is injectable in
`BudgetsService.getStatus(userId, id, now)`, so the computation is pure and
deterministic for tests.

### Money as a string (`limitAmount`, `limit`, `total`, `remaining`, `exceeded`)

All monetary fields are accepted and returned as **decimal strings** (e.g.
`"500.00"`), not JSON numbers. Limits are stored as PostgreSQL `Decimal(12,2)`
and status arithmetic uses `Decimal` throughout — never JS floats — so the sum
invariant holds to within `0.01` (design **ADR-5**).

**Not-found vs. authorization semantics (non-disclosing):** a `/:id` (and
`/:id/status`) that does not exist and one owned by **another user** both return
the **same 404 `NOT_FOUND`** (Req 9.9, 10.4, 3.2).

### Budget error codes

| Code                            | HTTP | When                                                                     |
| ------------------------------- | ---- | ------------------------------------------------------------------------ |
| `VALIDATION_ERROR`              | 400  | Invalid `limitAmount`/`period`, or the category is not owned/accessible. |
| `AUTH_REQUIRED` / `AUTH_FAILED` | 401  | Missing or invalid token.                                                |
| `NOT_FOUND`                     | 404  | The budget does not exist **or** is not owned (non-disclosing).          |

## Analytics

Spending insights summarize the caller's expenses. Both endpoints live under
`/api/v1/analytics` and require a valid Bearer token (they are **not**
`@Public()`); an unauthenticated request is rejected with **401** before the
handler runs. Every computation is **owner-scoped** — totals are derived only
from the authenticated user's expenses (Req 11.3), so another user's data can
never contribute to a result (see
[Per-user data isolation](#per-user-data-isolation)).

### Endpoints

| Method & path                       | Purpose                          | Success    |
| ----------------------------------- | -------------------------------- | ---------- |
| `GET /api/v1/analytics/monthly`     | Monthly spending total           | **200 OK** |
| `GET /api/v1/analytics/by-category` | Per-category totals over a range | **200 OK** |

### `GET /api/v1/analytics/monthly`

Query parameters:

| Parameter | Rule                        | Required |
| --------- | --------------------------- | -------- |
| `month`   | `YYYY-MM` (month `01`–`12`) | yes      |

Returns the arithmetic sum of the user's expenses dated within the given
calendar month. Success — **200 OK**:

```jsonc
{
  "month": "2024-01",
  "total": "1234.56", // two-decimal string; "0.00" when nothing matches
}
```

The month **window** is the full calendar month, **leap-aware** — e.g.
`2024-02` covers `2024-02-01 .. 2024-02-29`, `2023-02` ends on the 28th, April
on the 30th, January on the 31st. Both bounds are inclusive. Because the month
is explicit in the request, the window is a pure, deterministic mapping (no
"current time"/timezone resolution needed).

### `GET /api/v1/analytics/by-category`

Query parameters:

| Parameter   | Rule                                | Required |
| ----------- | ----------------------------------- | -------- |
| `startDate` | `YYYY-MM-DD`, inclusive lower bound | yes      |
| `endDate`   | `YYYY-MM-DD`, inclusive upper bound | yes      |

Returns the user's in-range expenses grouped by category, each with an
arithmetic per-category total. The range is **inclusive on both boundaries**.
Only categories with at least one in-range expense appear; the list is ordered
by `categoryId` ascending for a deterministic response. Success — **200 OK**:

```jsonc
{
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",
  "categories": [
    // empty [] when nothing matches
    {
      "categoryId": "7c3e0b1a-9d5f-4c2e-8a6b-1f2d3e4a5b6c",
      "total": "250.00",
    },
  ],
}
```

### Zero-on-empty, deletion exclusion, and range validation

- **Zero on empty (Req 11.4).** When no expenses match the requested month or
  range, `monthly` returns `total` `"0.00"` and `by-category` returns
  `categories: []` — **no error** is returned.
- **Deletion exclusion (Req 7.4).** A deleted expense is simply no longer a row,
  so every insight computed **after** the deletion excludes it naturally; a
  previously-included total decreases by exactly the deleted amount.
- **Invalid/missing/inverted range (Req 11.6).** A missing or malformed `month`,
  `startDate`, or `endDate` is rejected by the global `ValidationPipe` (a
  **400 `VALIDATION_ERROR`** naming the field) and **no insight is computed**.
  An inverted `by-category` range where `startDate` is after `endDate` is
  rejected the same way, and the cross-field check runs **before** any
  aggregation.

### Money as a string and mixed currency

All monetary totals are returned as **decimal strings** (e.g. `"1234.56"`), not
JSON numbers. Aggregation is performed with PostgreSQL `Decimal` SUM/`groupBy`
and serialized with `toFixed(2)`, so the sum invariant holds to within `0.01`
(design **ADR-5**).

**Mixed currency (A2).** Amounts are summed **numerically regardless of
currency**; **no currency conversion** is performed. A total therefore reflects
a plain numeric sum of amounts and is semantically single-currency only when the
user records a single currency. Cross-currency semantics are out of scope (see
the design §Ambiguities item 3).

### Analytics error codes

| Code                            | HTTP | When                                                                            |
| ------------------------------- | ---- | ------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`              | 400  | `month`/`startDate`/`endDate` missing or malformed, or `startDate` > `endDate`. |
| `AUTH_REQUIRED` / `AUTH_FAILED` | 401  | Missing or invalid token.                                                       |

## Security

The Platform's security posture is enforced in code and summarized below as a
checklist. Each item maps to what is implemented (and the phase that added it).

- **Password hashing** — passwords are stored only as a salted **argon2id** hash
  with a unique per-user salt. Plaintext is never stored, returned, or logged;
  two users with the same password get different hashes (Phase 3, Req 1.5).
- **Token validation + expiry** — JWTs are signed with `JWT_SECRET` and expire
  exactly **3600s** after issuance. An expired, malformed, or bad-signature token
  → **401 `AUTH_FAILED`**; a missing token on a protected route → **401
  `AUTH_REQUIRED`** (Phase 3).
- **Protected-by-default endpoints** — a global `JwtAuthGuard` requires a valid
  token on every route; only auth (`register`/`login`), the API docs, and the
  health probe are `@Public()`.
- **Per-user data isolation** — every read/write is owner-scoped
  (`userId = currentUser.id`), and single-resource routes use a non-disclosing
  **404** for "not found" and "not owned" alike, across expenses, categories,
  budgets, and analytics (Req 3.x).
- **Unauthorized access → appropriate errors** — a consistent envelope with
  **401** (auth) and **404** (isolation) status classes; existence of another
  user's resource is never disclosed.
- **Input validation** — a global `ValidationPipe`
  (`whitelist` + `forbidNonWhitelisted` + `transform`) plus per-endpoint DTOs.
  A rejection is a **400 `VALIDATION_ERROR`** whose `details[]` names each
  failing field; unknown/extra fields are rejected.
- **Safe database access** — all queries use Prisma's parameterized
  queries / tagged templates. There is **no** `$queryRawUnsafe` /
  `$executeRawUnsafe` anywhere; the health probe uses a safe, parameterless
  `SELECT 1`.
- **No sensitive info in responses/errors** — unexpected failures return a
  generic **500 `INTERNAL_ERROR`** with no stack, DB, path, or secret leakage;
  internal fields such as `userId` and `passwordHash` are never surfaced.
- **Secrets are not hardcoded** — `JWT_SECRET` and `DATABASE_URL` are sourced
  from environment configuration (never source). In production they are injected
  as Lambda environment variables resolved from **SSM Parameter Store / Secrets
  Manager** (or fetched at cold start); the function is granted a
  **least-privilege** `ssm:GetParameter` read scoped to the app's parameter path
  (`/expense/*`), per the design §Configuration / SAM template. Locally they come
  from `.env`.
- **CORS** — configured via `CORS_ORIGINS` (comma-separated allow-list). The
  **safe default** disables cross-origin access when unset (`origin: false`) — it
  never defaults to `'*'`, and never pairs `'*'` with credentials. Allowed
  headers include `Authorization` and `x-correlation-id` so authenticated
  cross-origin clients work when explicitly enabled.
- **Security-relevant events are logged without sensitive data** — the
  structured `LoggingInterceptor` logs only safe metadata; a redaction
  serializer scrubs known-sensitive keys as defense-in-depth (see
  [Observability / Logging](#observability--logging)).
- **Consistent, safe error responses** — every error uses a single envelope:
  `{ success: false, error: { code, message, details? }, meta: { correlationId } }`.
- **Common risks reviewed** — injection (parameterized Prisma), broken
  authorization (owner-scoping + guards, covered by the data-isolation property
  tests), and sensitive-data exposure (redaction + generic 500 + no PII in logs).
- **Production vs. local separation** — behavior is driven entirely by
  `RUNTIME_ENV` and env config through a single `configureApp()` and dual
  bootstrap; there is no divergent application source between environments.
- **Rate limiting (layered)** — account **lockout** after repeated failed logins
  (Phase 3), a coarse per-container `ThrottlerGuard` (**100 requests / 60s**),
  and **API Gateway throttling** as the authoritative, shared-state production
  recommendation (the in-memory throttler is per-warm-container by design).
- **Dependency hygiene** — `npm run audit` (`npm audit --omit=dev
--audit-level=high`) checks production dependencies. Current known transitive
  advisories: `lodash` (via `@nestjs/config`) and `multer` + `path-to-regexp`
  (via `@nestjs/platform-express`). Remediating them requires upgrading NestJS
  beyond the pinned ranges, so they are **tracked** rather than build-failing.

## Observability / Logging

Every request emits **one structured JSON log line** (one object per entry) via
the global `LoggingInterceptor`, so both the local server and the Lambda proxy
log identically (Req 16.5).

- **Fields** — `method`, `route` (the matched route pattern, e.g.
  `/api/v1/expenses/:id`, never the raw query string), `status`, `correlationId`,
  a millisecond-precision ISO `timestamp`, a severity `level`
  (`DEBUG`/`INFO`/`WARN`/`ERROR`), and `durationMs`. On failure the entry is
  `ERROR` and adds a coarse, non-sensitive error `category` (Req 14.1–14.3).
- **Correlation-id propagation** — `CorrelationIdMiddleware` reads an inbound
  `x-correlation-id` header or **generates a UUID** when absent, stores it in an
  `AsyncLocalStorage` context so all entries for a request share it, and echoes
  it back on the `x-correlation-id` response header (Req 14.6).
- **Secret redaction** — a redaction serializer replaces the value of any
  known-sensitive key (`password`, `authorization`, `token`, `secret`, `jwt`,
  `apikey`, `api_key`, `cookie` — matched case-insensitively as a substring, so
  `Authorization`, `accessToken`, `jwtSecret`, `X-Api-Key`, etc. are caught) with
  a fixed `[REDACTED]` placeholder before emission. The interceptor logs only
  safe metadata (never bodies, headers, or tokens); redaction is a
  belt-and-braces backstop (Req 14.4, 14.5).
- **Sinks** — `stdout` locally (`stderr` for `ERROR`); on Lambda, stdout is
  forwarded to **CloudWatch Logs** automatically.

## Health check

`GET /api/v1/health` is a **public** liveness/readiness probe (no token
required). It runs a bounded, parameterless `SELECT 1` against the database:

- **200 OK** — `{ "status": "ok", "db": "up" }` when the app is up and the DB
  responds within the timeout.
- **503 `DB_UNAVAILABLE`** — when the database cannot be reached within the
  bounded timeout; the response uses the standard error envelope and leaks no DB
  internals (Req 13.2, 16.4).

## Phase 8 implementation notes

- **Structured `LoggingInterceptor` (safe-metadata + redaction).** Registered
  globally in `configureApp()`. It logs **only** safe metadata (method, route,
  status, correlationId, durationMs, and — on error — the error category), which
  is the strongest guarantee that no raw secret reaches a log field; the
  assembled context is still passed through `redact()` as defense-in-depth so any
  future addition of a sensitive key is scrubbed. A companion
  `ResponseEnvelopeInterceptor` from the design is **intentionally not** added —
  success responses are already shaped by the controllers/services (and asserted
  by existing controller/e2e tests), so wrapping them now would break those
  shapes.
- **CORS safe default.** `CORS_ORIGINS` drives an allow-list; when unset,
  cross-origin access is disabled (`origin: false`) — never `'*'`, and never
  `'*'` with credentials. Applied identically on both runtime targets.
- **Health / DB-readiness → 503.** The health probe maps any DB connection
  failure/timeout to `DatabaseUnavailableException`, which the global
  `AllExceptionsFilter` renders as a **503 `DB_UNAVAILABLE`** envelope with no DB
  internals.
- **Layered rate-limiting decision.** Account lockout (Phase 3) guards credential
  brute-force; a coarse in-memory `ThrottlerGuard` (100/60s) blunts request
  floods per warm container; API Gateway throttling is the authoritative,
  shared-state production layer (the in-memory throttler is per-container by
  design, which is exactly why the Gateway layer is recommended).
- **Config fail-fast + secret sourcing.** `validateEnv` (Zod) aggregates all
  problems and terminates startup with a single error **naming every offending
  key** (and, for type failures, the expected type). Secrets are sourced from env
  config only — `.env` locally, SSM/Secrets Manager injected as Lambda env vars
  in production.
- **Property coverage.** Properties 30–32 are implemented under
  `test/properties/` as `fast-check` suites (≥100 runs each), tagged
  `// Feature: smart-expense-insights-platform, Property N`, and are **fully
  pure (no database)** so they always run:
  - **30** (`log-entry-shape.property.spec.ts`) drives the real
    `LoggingInterceptor` (capturing the emitted JSON line) and the real
    `CorrelationIdMiddleware` (id generation + propagation).
  - **31** (`log-redaction.property.spec.ts`) drives the real `redact`
    serializer and the real logger/interceptor path, proving no raw secret
    survives and every sensitive value becomes `[REDACTED]`.
  - **32** (`config-fail-fast.property.spec.ts`) drives the real `validateEnv`
    over the required-key × missing-ness matrix (plus type-invalid examples and
    multi-key aggregation), and confirms a valid env returns the defaulted
    config.

## Data Model

The data model is defined in [`prisma/schema.prisma`](./prisma/schema.prisma)
and materialized by the committed migration under `prisma/migrations/`. It
mirrors the design document's Data Models section. Apply it and load demo data
with the migrate/seed commands documented under
[Database (PostgreSQL + Prisma)](#database-postgresql--prisma)
(`npm run prisma:migrate:dev`, `npm run prisma:migrate:deploy`, `npm run db:seed`).

### Entities and key fields

| Entity         | Key fields                                                                                                                                               | Notes                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `User`         | `id` (uuid PK), `email`, `emailCi`, `passwordHash`                                                                                                       | `email` preserves the original casing; `emailCi` is the normalized (lowercased) form. Only a salted hash is stored — never plaintext (Req 1.5). |
| `Category`     | `id`, `userId` (FK→User), `name`, `nameCi`                                                                                                               | `nameCi` is the trimmed/lowercased name used for uniqueness.                                                                                    |
| `Expense`      | `id`, `userId` (FK→User), `categoryId` (FK→Category), `amount` `Decimal(12,2)`, `currency` `char(3)`, `date` (date-only), `description` (≤500, nullable) | A single monetary outflow owned by a user.                                                                                                      |
| `Budget`       | `id`, `userId` (FK→User), `categoryId` (FK→Category, **nullable**), `limitAmount` `Decimal(12,2)`, `period` (`weekly`\|`monthly`\|`yearly`)              | A spending limit for a period, optionally scoped to a category.                                                                                 |
| `LoginAttempt` | `email` (PK), `failedCount`, `windowStart`, `lockedUntil`                                                                                                | Shared login-attempt/lockout state (Req 2.7), persisted so lockout behaves consistently across stateless Lambda containers.                     |

### Relationships

- **User 1—\* Category / Expense / Budget** — every record is owned by exactly one user.
- **Category 1—\* Expense** — an expense is classified by one category.
- **Category 0..1—\* Budget** — a budget may be scoped to a category or be unscoped (all categories).

```mermaid
erDiagram
    USER ||--o{ CATEGORY : owns
    USER ||--o{ EXPENSE : owns
    USER ||--o{ BUDGET : owns
    CATEGORY ||--o{ EXPENSE : classifies
    CATEGORY ||--o{ BUDGET : scopes
```

### Constraints and `onDelete` rules

- **Case-insensitive email uniqueness** — unique index on `User.emailCi`
  (Req 1.2). Registering any case-variant of an existing email conflicts.
- **Per-user case-insensitive category uniqueness** — unique index on
  `Category(userId, nameCi)` (Req 8.3). Two categories with the same trimmed,
  lowercased name for one user are rejected.
- **`Expense.categoryId` → `ON DELETE RESTRICT`** — a category referenced by one
  or more expenses **cannot** be deleted; the Categories service surfaces this
  as a conflict (Req 8.7). Deletion succeeds only when unreferenced (Req 8.8).
- **`Budget.categoryId` → `ON DELETE SET NULL`** — the design mandates RESTRICT
  only for `Expense → Category` and leaves `Budget → Category` unspecified. We
  chose `SET NULL` so deleting a category (permitted only when no expenses
  reference it) converts an affected budget into an unscoped (all-categories)
  budget rather than deleting the user's budget or blocking the delete. This
  avoids conflicting with the Expense RESTRICT rule and preserves budget data.
- **User-owned data → `ON DELETE CASCADE`** — deleting a `User` cascades to that
  user's categories, expenses, and budgets.

### Money and dates

- Money is stored as **`Decimal(12,2)`** everywhere (`Expense.amount`,
  `Budget.limitAmount`). `Decimal` avoids binary floating-point error and
  guarantees exact two-decimal arithmetic, which underpins the analytics/budget
  sum invariants (Req 4.1, 6.1, 9.1, 11.5). `12,2` covers the maximum
  `999,999,999.99`.
- `Expense.date` is stored as a **date-only** value. All month/period windows
  are evaluated in the single configured `PLATFORM_TIMEZONE` (A3), so date-only
  storage keeps a record from drifting between months due to time-of-day.

### Indexes and the queries they serve

| Index                               | Serves                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `User.emailCi` (unique)             | Login lookup + case-insensitive uniqueness (Req 1.2).                               |
| `Category(userId, nameCi)` (unique) | Per-user uniqueness (Req 8.3).                                                      |
| `Category(userId)`                  | Owner-scoped category listing (Req 8.4).                                            |
| `Expense(userId, date)`             | Default date-descending list ordering + monthly-range queries (Req 5.2, 5.3, 11.1). |
| `Expense(userId, categoryId)`       | Category filter + by-category insight (Req 5.4, 11.2).                              |
| `Budget(userId)`                    | Owner-scoped budget listing (Req 9.6).                                              |

## Phase 2 implementation notes

- **`PrismaService` — cached singleton + connect timeout.** `PrismaService`
  extends `PrismaClient` and is provided by a `@Global()` `PrismaModule`, so a
  single client is instantiated once per process and reused across warm Lambda
  invocations (avoiding per-request connection churn; C3, C6). On `onModuleInit`
  the initial `$connect()` is raced against a **10-second** bound
  (`DB_CONNECT_TIMEOUT_MS`); a timeout — or any other connection failure — is
  mapped to a `DatabaseUnavailableException` carrying the machine-readable code
  `DB_UNAVAILABLE` (HTTP 503), leaving persisted data unchanged (Req 16.4).
  `onModuleDestroy` cleanly `$disconnect()`s (not called between warm Lambda
  invocations, which is desirable).
- **Offline migration generation.** The initial migration
  (`prisma/migrations/20240101000000_init/migration.sql`) is committed to the
  repository, so the schema can be applied to any fresh database with
  `prisma migrate deploy` without an interactive authoring step and without a
  database being reachable at build time. `prisma generate` likewise runs
  offline. This keeps the build and the non-gated test suite deterministic in
  environments (such as CI) with no PostgreSQL available.

## Phase 4 implementation notes

- **Owner-scoped everything.** `ExpensesService` merges `ownerScope(userId)`
  into every query. Single-resource reads/updates/deletes load with
  `findFirst({ where: { id, ...ownerScope(userId) } })` and pass through
  `assertOwnership()`, so a missing row and a row owned by someone else collapse
  to the identical non-disclosing **404 `NOT_FOUND`** (Req 3.2). List queries
  count and page inside a single `$transaction` for a consistent `total`.
- **Validation before writes.** The not-future date check (evaluated in
  `PLATFORM_TIMEZONE`) and the category-ownership check run **before** any
  create/update write, so a rejected request never persists or mutates a row
  (Req 4.2–4.5, 6.2–6.4). A foreign/missing category is a **400
  `VALIDATION_ERROR`** ("category is invalid"), deliberately distinct from the
  404 used for an unknown/foreign expense id.
- **Decimal-as-string wire format.** Amounts are `Prisma.Decimal` in the domain
  and serialized to a two-decimal string via `toFixed(2)` in the response mapper
  (ADR-5). Dates are stored `@db.Date` and rendered `YYYY-MM-DD` from their UTC
  parts to keep day-granularity semantics stable across host time zones (A3).
- **Property coverage.** Properties 16–21 are implemented under
  `test/properties/` as `fast-check` suites (≥100 runs each), tagged
  `// Feature: smart-expense-insights-platform, Property N`:
  - **19** (input validation) and **21** (malformed list parameters) have a
    **pure** portion that drives the DTOs through class-validator exactly as the
    global `ValidationPipe` does — these always run with no database.
  - **16** (create/read), **17** (update), **18** (delete), **20** (list
    filter/order/pagination), and the service-level parts of **19**/**21**
    (foreign category, future date, inverted range) are **DB-gated** on
    `DATABASE_TEST_URL` and skip cleanly when it is unset (see
    [Running the database integration tests](#running-the-database-integration-tests)).

## Phase 5 implementation notes

- **Category normalization is a single source of truth.** Trimming, the 1–100
  char length rule (evaluated **after** trimming), and case-insensitive
  uniqueness all live in `CategoriesService` rather than the DTO. The DTO only
  guarantees a non-empty string within a generous bound, so a padded/case
  variant of an existing name reaches the service and is consistently rejected
  (Req 8.1–8.3, 8.5). A unique index on `Category(userId, nameCi)` backs the
  pre-check, and a `P2002` race is mapped to the same `CONFLICT`.
- **Explicit delete-guard, FK RESTRICT as backstop.** Category deletion runs an
  owner-scoped `expense.count` and returns a clean **409 `CONFLICT`** when the
  category is referenced (Req 8.7); the `Expense.categoryId → ON DELETE
RESTRICT` FK remains a database-level backstop. Deletion succeeds only when
  unreferenced (Req 8.8).
- **Decimal budget arithmetic.** Budget limits are `Decimal(12,2)` and
  `getStatus` computes `total`/`remaining`/`exceeded` with `Prisma.Decimal`
  (never JS floats), preserving the sum invariant to within `0.01` (feeds
  Property 25). Monetary fields serialize to two-decimal strings (ADR-5).
- **Injectable reference date for deterministic status.**
  `BudgetsService.getStatus(userId, id, now = new Date())` takes the "now"
  instant as a parameter, and `computePeriodWindow(period, reference, timeZone)`
  is a pure function. This makes the period window (and therefore the whole
  status computation) deterministic and unit/property-testable without relying
  on wall-clock time.
- **ADR — Monday week-start (ISO-8601).** For `weekly` budgets the requirements
  do not fix a week-start day, so we chose **Monday..Sunday (ISO-8601)** as a
  documented, deterministic convention. `monthly` = the calendar month and
  `yearly` = the calendar year; all windows are inclusive and evaluated in
  `PLATFORM_TIMEZONE`.
- **Property coverage.** Properties 22–25 are implemented under
  `test/properties/` as `fast-check` suites (≥100 runs each), tagged
  `// Feature: smart-expense-insights-platform, Property N`:
  - **22** (category name/uniqueness) and **24** (budget creation validation)
    have a **pure** portion that drives the DTOs/validators through
    class-validator exactly as the global `ValidationPipe` does — these always
    run with no database.
  - **25** (budget status) has a **pure** portion that asserts
    `computePeriodWindow` window invariants directly (leap-aware month bounds,
    Jan–Dec year bounds, Monday–Sunday 7-day weeks containing the reference
    day) — this always runs with no database.
  - The service-level parts of **22**/**24** (trim/length/uniqueness against a
    real row, foreign-category rejection), **23** (category delete vs
    references), and **25** (status over seeded in-scope/in-period expenses with
    out-of-window / other-category / other-user decoys) are **DB-gated** on
    `DATABASE_TEST_URL` and skip cleanly when it is unset (see
    [Running the database integration tests](#running-the-database-integration-tests)).

## Phase 6 implementation notes

- **Owner-scoped Decimal aggregation.** `AnalyticsService` sums with the
  database: `monthlyTotal` uses `expense.aggregate({ _sum: { amount } })` and
  `byCategory` uses `expense.groupBy({ by: ['categoryId'], _sum: { amount } })`,
  each merging `ownerScope(userId)` so a total is derived **only** from the
  requesting user's expenses (Req 11.3). A null SUM (no matching rows) maps to
  `Decimal(0)` and serializes as `"0.00"`, so an empty match returns zero totals
  rather than an error (Req 11.4). Deleted expenses are excluded naturally —
  they are no longer rows (Req 7.4).
- **Pure, deterministic month window.** `monthWindow(month)` (in
  `src/analytics/month-window.ts`) maps a `YYYY-MM` to the inclusive
  `[first day .. last day]` calendar window, leap-aware, with **no** wall-clock
  or timezone dependence. This makes the window math unit/property-testable
  directly, independent of the database.
- **Cross-field range check before aggregation.** `byCategory` enforces
  `startDate <= endDate` and throws a `VALIDATION_ERROR` **before** issuing any
  query, so an inverted range computes no insight (Req 11.6). The syntactic
  `month`/`startDate`/`endDate` rules live in the DTOs (`IsMonth`,
  `IsCalendarDate`) and are enforced by the global `ValidationPipe`.
- **Decimal-as-string wire format.** Totals are `Prisma.Decimal` in the domain
  and serialized with `toFixed(2)` (ADR-5), preserving the sum invariant to
  within `0.01` (Req 11.5, 17.5).
- **Mixed currency (A2).** Amounts are summed numerically regardless of
  currency; no conversion is done (design §Ambiguities item 3).
- **Property coverage.** Properties 1–5 are implemented under `test/properties/`
  as `fast-check` suites (≥100 runs each), tagged
  `// Feature: smart-expense-insights-platform, Property N`:
  - **1** (monthly sum) has a **pure** portion asserting `monthWindow`
    invariants (leap-aware first/last-day bounds, `start <= end`) — this always
    runs with no database.
  - **5** (invalid range rejected) is **fully pure**: the DTO validators reject
    a missing/malformed `month`/`startDate`/`endDate` naming the field,
    `parseMonth` totality is checked, and the inverted-range service rejection is
    proven against a Prisma **stub** whose `groupBy`/`aggregate` throw if ever
    called (asserting no aggregation happens).
  - The DB portion of **1** (monthly sum over seeded expenses) and all of **2**
    (by-category sum + exact coverage), **3** (deletion drops totals by exactly
    the deleted amount), and **4** (empty → zero totals, no error) are
    **DB-gated** on `DATABASE_TEST_URL` and skip cleanly when it is unset (see
    [Running the database integration tests](#running-the-database-integration-tests)).

## Testing

The full automated suite runs through a single command:

```bash
npm test
```

`npm test` is the **single documented command** that runs the FULL automated
suite — unit, property-based, integration, and end-to-end specs — in one pass
(Req 17.1). The runner reports the total number of tests executed, passed,
skipped, and failed (Req 17.2), and **exits with a non-zero status code and
names each failing test** if any test fails (Req 17.6). Additional test
commands:

```bash
npm run test:watch   # watch mode
npm run test:cov     # full suite with coverage
npm run test:e2e     # end-to-end config (test/jest-e2e.json) — a subset view
```

> `npm test` already includes the e2e specs (they are named `*.spec.ts` under
> `test/e2e/` so the default Jest `testRegex` picks them up); `npm run test:e2e`
> is a convenience config for running only the `*.e2e-spec.ts` files.

### Where each kind of test lives

| Directory           | Kind                        | Runs without a DB?                                       |
| ------------------- | --------------------------- | -------------------------------------------------------- |
| `test/unit/`        | Unit tests                  | Yes                                                      |
| `test/properties/`  | Property-based (fast-check) | Pure + HTTP-edge: yes. DB-gated ones: skip without a DB. |
| `test/integration/` | Live-DB integration         | Skipped without `DATABASE_TEST_URL`                      |
| `test/e2e/`         | End-to-end (Supertest)      | Skipped without `DATABASE_TEST_URL`                      |

Property-based tests use `fast-check` (minimum 100 iterations each) and validate
the design's correctness properties.

### No-database default (what runs, what skips)

With **no database** configured, `npm test` stays green and exercises a large
portion of the suite:

- **Unit tests** — env-validation fail-fast, the connect-timeout →
  `DB_UNAVAILABLE` mapping (via mocked client lifecycle), and the committed
  migration DDL.
- **Pure property tests** — DTO/validator logic and pure computation
  (e.g. budget period-window math) driven directly.
- **HTTP-edge property tests** — Properties 26–28 build a tiny in-memory Nest
  app (Supertest, **no database**) that applies the real global `ValidationPipe`
  - `AllExceptionsFilter` via `configureApp()` and drives `@Public()` probe
    controllers. They assert: validation rejection is total and field-identifying
    (26), the consistent error envelope + 4xx/5xx status class (27), and that
    internal-error responses leak no internals (28).

The **live-database** tests skip cleanly when `DATABASE_TEST_URL` is unset:

- the schema-enforcement specs under `test/integration/`;
- the DB-gated property specs under `test/properties/` (expense round-trips and
  list filter/order/pagination, budget status, the analytics
  sum-invariant / deletion-exclusion / zero-on-empty specs, and the
  transactional-rollback property, **29**);
- the full **end-to-end** suite under `test/e2e/`.

### Running the full database-backed suite

To run everything — including the integration, e2e, and DB-gated property specs
— start a throwaway PostgreSQL and point the suite at it with
`DATABASE_TEST_URL`. The gated specs apply the committed migrations with
`prisma migrate deploy` before running and truncate every table between tests
for determinism:

```bash
# Start a throwaway database (see Option A above), then:
DATABASE_TEST_URL="postgresql://postgres:postgres@localhost:5432/expense_test?schema=public" npm test
```

The **end-to-end** suite (`test/e2e/app.e2e.spec.ts`) boots the real `AppModule`
through `configureApp()` against `DATABASE_TEST_URL` and drives it over HTTP with
Supertest, obtaining a real Bearer token through `POST /api/v1/auth/login`. It
covers at least one test per functional area — authentication, expense
create/read/update/delete, category management, budget tracking, and analytics
(Req 17.3) — plus cross-user **data isolation** (user B receives none of user A's
data; Req 17.4) and the analytics **sum-invariant** to a 0.01 tolerance
(Req 17.5). See also
[Running the database integration tests](#running-the-database-integration-tests).

## CI/CD

The pipeline is defined in
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) and runs on every push
to `main` and on every pull request targeting `main`. Superseded runs on the
same ref are cancelled automatically to save CI minutes.

### Pipeline stages

**1. `build-test` — Build, lint and test** (runs on both push and pull request)

Runs on `ubuntu-24.04` with Node.js 20 and executes, in order:

| Step                       | Command                    | Purpose                                                   |
| -------------------------- | -------------------------- | --------------------------------------------------------- |
| Install dependencies       | `npm ci`                   | Reproducible install from the pinned lockfile.            |
| Generate Prisma client     | `npm run prisma:generate`  | Produce the typed client (no database required).          |
| Build                      | `npm run build`            | Compile TypeScript to `dist/`.                            |
| Lint                       | `npm run lint`             | Static analysis / style enforcement.                      |
| Test (with coverage)       | `npm run test:cov`         | The single documented test command, run with coverage.    |

The suite runs in its **no-database default mode**: `DATABASE_TEST_URL` is left
unset, so the DB-gated integration/e2e/property specs self-skip and the pipeline
stays green without provisioning a database (see [Testing](#testing)). Jest
exits non-zero and names each failing test on any failure, which fails the step
and therefore the whole job.

**2. `migrate-deploy` — Release, migrate deploy (gated)** (push to `main` only)

A gated, non-interactive migration **release stage** that applies the committed
Prisma migrations to a shared environment's database:

```bash
npm run prisma:migrate:deploy   # prisma migrate deploy — forward-only, no prompts
```

It is deliberately fenced off from ordinary CI runs:

- **Push-to-`main` only** — `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`,
  so it never runs on pull requests (a fork PR can never touch a shared
  database).
- **Depends on a green build** — `needs: build-test`, so migrations are only
  applied after build, lint, and the full test suite pass.
- **Environment-scoped secret** — it runs in the protected `production`
  environment and reads `DATABASE_URL` from that environment's secrets, which
  lets you require reviewers / branch protection on the deploy.
- **No-ops safely when unconfigured** — if `DATABASE_URL` is empty (e.g. a fork
  or a repo with no deployment target), the deploy step logs a skip and exits
  `0` instead of failing.

`prisma migrate deploy` is non-interactive and forward-only: it applies only
committed migrations and exits non-zero (failing the job) if any migration
cannot be applied. This is the same command used to prepare the RDS database as
an AWS release step.

### Requirement mapping

| Pipeline stage / step                                    | Requirement |
| -------------------------------------------------------- | ----------- |
| Test step runs the full suite via one documented command | Req 17.1    |
| Test step reports totals (executed / passed / failed)    | Req 17.2    |
| Test step exits non-zero and names each failing test     | Req 17.6    |
| `migrate-deploy` gated non-interactive `migrate deploy`  | Req 16.6    |

## AWS SAM build / deploy flow

Deploying to AWS packages the **same** application (`dist/main.handler`) as a
Lambda behind API Gateway, backed by PostgreSQL on RDS (Req 16.3, 16.5, 16.6).
The flow is scripted as npm scripts that compose the existing build steps, and
requires the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
and configured AWS credentials. `template.yaml` and `samconfig.toml` define the
stack and deploy parameters.

The ordered release flow (design §Build / package / deploy flow):

```bash
# 1–3. Generate the Prisma client + engine for the Lambda target, compile TS,
#       and package the function with SAM (bundles the Prisma engine).
npm run sam:build            # = prisma generate && nest build && sam build

# 4. Provision / update the stack (API Gateway, Lambda, IAM, VPC config).
npm run sam:deploy           # sam deploy   (use sam:deploy:guided the first time)

# 5. Apply committed migrations to RDS as a release step (DATABASE_URL from env,
#    pointed at the RDS instance). Non-interactive and forward-only.
DATABASE_URL="postgresql://…rds…" npm run release:migrate
```

`npm run release` runs steps 1–5 end to end (`sam:build` → `sam:deploy` →
`release:migrate`). `prisma migrate deploy` here is the same non-interactive,
forward-only command used by the CI `migrate-deploy` stage above; point
`DATABASE_URL` at the RDS instance so the released schema matches the deployed
function.

| Script                   | Runs                                              |
| ------------------------ | ------------------------------------------------- |
| `sam:prebuild`           | `prisma generate` + `npm run build`               |
| `sam:build`              | `sam:prebuild` + `sam build`                      |
| `sam:deploy`             | `sam deploy`                                       |
| `sam:deploy:guided`      | `sam deploy --guided` (first-time / reconfigure)  |
| `release:migrate`        | `prisma migrate deploy` (against RDS via env)     |
| `release`                | `sam:build` → `sam:deploy` → `release:migrate`    |

### Prerequisites

- The [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
  installed and on your `PATH`.
- AWS credentials configured for the target account (e.g. `aws configure`, an
  SSO profile, or environment variables) with permission to create the stack's
  resources (Lambda, API Gateway, IAM, and VPC networking).
- An existing VPC with **private subnets** and a **security group** for the
  function, plus a reachable **RDS PostgreSQL** instance (see
  [VPC and RDS connectivity](#vpc-and-rds-connectivity)).
- Two SSM Parameter Store parameters created ahead of deploy — the database
  connection string and the JWT secret (see
  [Secrets via SSM](#secrets-via-ssm-least-privilege-iam)).

### `template.yaml` parameters

`template.yaml` keeps secrets and account-specific ids out of source by taking
them as CloudFormation **parameters**, supplied at deploy time (interactively
with `sam:deploy:guided`, or via `parameter_overrides` in `samconfig.toml`):

| Parameter               | Type                                | Purpose                                                                                          |
| ----------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `DatabaseUrl`           | `SSM::Parameter::Value<String>`     | **Name** of the SSM parameter holding the RDS connection string; resolved at deploy and injected as `DATABASE_URL`. Default `/expense/database-url`. |
| `JwtSecret`             | `SSM::Parameter::Value<String>`     | **Name** of the SSM parameter holding the JWT signing secret; injected as `JWT_SECRET`. Default `/expense/jwt-secret`. Store the underlying value as a `SecureString`. |
| `PlatformTimezone`      | `String`                            | IANA time zone used for analytics date grouping. Default `UTC`.                                  |
| `LambdaSecurityGroupId` | `EC2::SecurityGroup::Id`            | Security group attached to the Lambda; must allow egress to the RDS security group on the Postgres port. |
| `PrivateSubnetIds`      | `List<EC2::Subnet::Id>`             | Private subnets the Lambda runs in so it can reach RDS. Provide **at least two** subnets in different AZs. |
| `SsmParameterPath`      | `String`                            | Base path (no trailing slash) under which the app's SSM parameters live; scopes the least-privilege `ssm:GetParameter` grant. Default `/expense`. |

`DatabaseUrl` and `JwtSecret` are `NoEcho` and resolve their **values** from SSM
at deploy time, so only the parameter **names** and infrastructure ids are ever
written to `samconfig.toml`.

### VPC and RDS connectivity

The function runs inside the VPC via `VpcConfig`, attaching `LambdaSecurityGroupId`
to the subnets in `PrivateSubnetIds`, so it can reach the RDS instance on its
private endpoint. The RDS security group should allow inbound PostgreSQL traffic
**from the Lambda security group** (not from the public internet). Because the
function runs in private subnets, ensure SSM Parameter Store is reachable at cold
start via a **NAT gateway** or **VPC interface endpoints** for SSM. Placing the
Lambda in at least two AZs (via multiple private subnets) keeps it available if
one AZ is impaired. Under high concurrency, front RDS with **RDS Proxy** to pool
connections (design recommendation, see design §Connection management in Lambda).

### Secrets via SSM (least-privilege IAM)

Secrets are never committed or hard-coded. Before the first deploy, create the
two parameters under the configured path — for example:

```bash
aws ssm put-parameter --name /expense/database-url --type SecureString \
  --value "postgresql://user:pass@your-rds-host:5432/expense?schema=public"
aws ssm put-parameter --name /expense/jwt-secret --type SecureString \
  --value "<a long random secret>"
```

The function's execution role is granted only:

- **`AWSLambdaVPCAccessExecutionRole`** — the managed policy needed to create and
  manage the elastic network interfaces that let the function run in the VPC.
- A **least-privilege** inline statement allowing `ssm:GetParameter`,
  `ssm:GetParameters`, and `ssm:GetParametersByPath` **scoped to
  `${SsmParameterPath}` and `${SsmParameterPath}/*` only** — so the function can
  read its own parameters and nothing else in the account.

### Prisma engine bundling

Prisma needs the query engine binary that matches the Lambda runtime. The
schema's `binaryTargets` includes both `native` (for local development) and
**`rhel-openssl-3.0.x`** for the Lambda runtime (Amazon Linux 2023 /
`nodejs20.x`). Running `prisma generate` before packaging produces the
`libquery_engine-rhel-openssl-3.0.x.so.node` binary under
`node_modules/.prisma/client`, which is bundled into the deployment artifact by
`sam build`. This is why the flow runs **`prisma generate` before `sam build`**;
if the engine target does not match the chosen runtime, the function fails to
initialize Prisma at cold start (see design §Prisma engine bundling and §22
risk 6).

### RDS migration release step

Deploying the function does **not** change the database schema. After the stack
is updated, apply the committed migrations to RDS as an explicit release step
with `npm run release:migrate` (`prisma migrate deploy`) — the same
non-interactive, forward-only command used by the CI `migrate-deploy` stage.
Point `DATABASE_URL` at the RDS instance for this step so the released schema
matches the deployed function. `npm run release` chains `sam:build` →
`sam:deploy` → `release:migrate` in that order.

## Configuration

Runtime settings come entirely from environment configuration — no code changes
are needed to run in a different environment. See [`.env.example`](./.env.example)
for the full list of keys, placeholder values, and per-key notes.

Configuration is validated at startup (`src/config/env.validation.ts`). If a
required value is missing, empty, whitespace-only, or has the wrong type, the
process aborts before accepting requests and the error names every offending key
(and, for type mismatches, the expected type). Secrets such as `JWT_SECRET` and
`DATABASE_URL` are always read from configuration, never hardcoded.

| Key                     | Required | Default | Description                                     |
| ----------------------- | -------- | ------- | ----------------------------------------------- |
| `RUNTIME_ENV`           | yes      | —       | `local` (HTTP server) or `aws` (Lambda handler) |
| `PORT`                  | yes      | —       | Local HTTP port (positive integer)              |
| `DATABASE_URL`          | yes      | —       | PostgreSQL connection string                    |
| `JWT_SECRET`            | yes      | —       | JWT signing secret                              |
| `JWT_EXPIRES_IN`        | no       | `3600`  | Token lifetime in seconds                       |
| `PLATFORM_TIMEZONE`     | no       | `UTC`   | Time zone for date grouping                     |
| `LOG_LEVEL`             | no       | `info`  | One of `debug`, `info`, `warn`, `error`         |
| `LOGIN_MAX_ATTEMPTS`    | no       | `5`     | Failed logins before lockout                    |
| `LOGIN_WINDOW_MINUTES`  | no       | `15`    | Window for counting failed logins               |
| `LOGIN_LOCKOUT_SECONDS` | no       | `900`   | Lockout duration after threshold                |

## Project structure

```
src/
  main.ts                 # dual bootstrap: local listen() + Lambda handler
  app.module.ts           # root module wiring
  config/                 # env validation, config module, configureApp()
  common/
    middleware/           # correlation-id middleware
    logging/              # structured logger + redaction skeleton
    filters/ interceptors/ guards/ decorators/   # (added in later phases)
  prisma/                 # Prisma service (Phase 2)
  auth/ users/            # authentication & authorization (Phase 3)
  categories/ expenses/   # expense & category management (Phases 4–5)
  budgets/ analytics/     # budgets & spending insights (Phases 5–6)
  health/                 # health / readiness (later)
prisma/                   # schema.prisma, migrations, seed (Phase 2)
test/
  unit/ integration/      # unit tests + gated live-DB integration tests
  properties/ e2e/        # property-based and end-to-end tests
```

`configureApp()` (in `src/config/configure-app.ts`) is the single source of
truth for global wiring (prefix, versioning, API docs, and later pipes/filters/
interceptors/guards). It is applied by both the local and Lambda bootstrap paths
so the two environments expose identical behavior.
## Architecture overview

At a glance, the Platform is a **layered, modular NestJS application** that runs
unchanged both as a local Express HTTP server and as an AWS Lambda behind API
Gateway. The sections above document each capability in depth; this section ties
them together into a single mental model.

### Layered NestJS modules

Each domain is a **self-contained module** with a clear separation of
responsibilities:

- **Controllers** — the HTTP boundary: routing, request binding, and delegation.
  They hold no business logic.
- **Services** — business rules, orchestration, transactions, and **owner-scoped
  queries** (`ownerScope(userId)`), which are where per-user isolation is
  enforced.
- **DTOs** — the validation/serialization contract (class-validator /
  class-transformer), enforced by the global `ValidationPipe`.
- **Cross-cutting concerns** — validation, error mapping, structured logging,
  correlation-id propagation, authentication, and ownership are applied
  **globally** (pipes, filters, interceptors, guards, middleware), so every
  endpoint behaves consistently.

The domain modules are `AuthModule` / `UsersModule` (registration, login, token
issuance, lockout), `CategoriesModule`, `ExpensesModule`, `BudgetsModule`,
`AnalyticsModule`, plus `PrismaModule` (connection lifecycle), `HealthModule`
(liveness/readiness), `ConfigModule` (validated env), and a shared `CommonModule`
for the cross-cutting providers. See [Project structure](#project-structure) for
the on-disk layout.

### Single codebase, local + Lambda (via `configureApp`)

**Deployment portability** is the defining characteristic: there is **no
divergent application source** between environments. `main.ts` is a **dual
bootstrap** — it calls `app.listen(PORT)` when `RUNTIME_ENV` is not `aws`, and
otherwise exports a Lambda `handler` that proxies API Gateway events into the
same Nest app through a serverless-express adapter (**ADR-1**). Both paths run
the identical `configureApp()` (in `src/config/configure-app.ts`), which is the
**single source of truth** for global wiring — the `/api/v1` prefix and URI
versioning, OpenAPI docs, the `ValidationPipe`, the `AllExceptionsFilter`, the
`LoggingInterceptor`, and the `JwtAuthGuard`. Behavior is driven entirely by
`RUNTIME_ENV` and env configuration, so the two environments expose identical
behavior (see [Configuration](#configuration) and
[AWS SAM build / deploy flow](#aws-sam-build--deploy-flow)).

### Request flow

Every request — local or on Lambda — passes through the same ordered pipeline:

1. **Correlation-id middleware** reads an inbound `x-correlation-id` or generates
   a UUID, stores it in `AsyncLocalStorage`, and echoes it on the response.
2. **`JwtAuthGuard`** (global) rejects a missing/expired/malformed token on any
   route except those marked `@Public()` (register, login, docs, health).
3. **Ownership guard / owner-scoped queries** enforce per-user data isolation for
   `/:id` resources (non-disclosing 404 for "not found" and "not owned" alike).
4. **Global `ValidationPipe`** (`whitelist` + `forbidNonWhitelisted` +
   `transform`) validates the DTO before any business logic runs.
5. **Controller → Service → Prisma** executes the operation.
6. **`AllExceptionsFilter`** maps any error to the consistent response envelope,
   stripping internals.
7. **`LoggingInterceptor`** emits one structured JSON log line (safe metadata +
   secret redaction).

### PostgreSQL / Prisma

Data lives in **PostgreSQL**, accessed through **Prisma**. The schema
(`prisma/schema.prisma`) is materialized by committed migrations and covers
`User`, `Category`, `Expense`, `Budget`, and `LoginAttempt` (see
[Data Model](#data-model)). Money is stored as `Decimal(12,2)` throughout
(**ADR-5**), all access goes through parameterized Prisma queries (no raw SQL),
and `PrismaService` is a `@Global()`, cached singleton with a bounded 10s connect
timeout that maps connection failure to a **503 `DB_UNAVAILABLE`** (**ADR-6**).
Under Lambda concurrency, RDS Proxy is the recommended connection-pooling layer
(**ADR-3**).

### The `/api/v1` surface

All routes are served under the `/api/v1` prefix (global prefix `api` + URI
version `1`). The functional surface is:

| Area          | Base path              | Auth        |
| ------------- | ---------------------- | ----------- |
| Authentication | `/api/v1/auth`         | public      |
| Expenses       | `/api/v1/expenses`     | Bearer      |
| Categories     | `/api/v1/categories`   | Bearer      |
| Budgets        | `/api/v1/budgets`      | Bearer      |
| Analytics      | `/api/v1/analytics`    | Bearer      |
| API docs       | `/api/v1/docs`         | public      |
| Health         | `/api/v1/health`       | public      |

Every non-public route requires a valid JWT Bearer token; errors use the single
consistent envelope (**ADR-8**).

## Architecture Decision Records (ADR) summary

The design records the key decisions as ADRs. Each states the decision, the
alternative considered, and the tradeoff accepted. They are summarized here for
quick reference (the authoritative text lives in the design document).

| ADR | Decision | Alternative | Tradeoff accepted |
| --- | -------- | ----------- | ----------------- |
| **ADR-1** | **serverless-express single bootstrap** — proxy API Gateway events into the same Nest/Express app so one codebase serves local and Lambda. | Separate Lambda handlers; AWS Lambda Web Adapter. | A thin adapter dependency, in exchange for zero divergent source. |
| **ADR-2** | **API Gateway HTTP API** over REST API — lower latency/cost, simpler proxy integration (in-app validation makes gateway validation redundant). | REST API. | Forgoes usage plans / API keys / tight WAF integration. |
| **ADR-3** | **RDS Proxy** (recommended) to pool connections against Lambda concurrency. | Direct connection with `connection_limit=1`. | Added cost/latency, in exchange for avoiding connection exhaustion. |
| **ADR-4** | **JWT over server-side sessions** — stateless tokens fit the stateless Lambda model and the 3600s expiry. | Server-side sessions. | Tokens are not revocable before expiry without extra state. |
| **ADR-5** | **Decimal-as-string money** — store/compute money as `Decimal(12,2)` and serialize as a two-decimal string on the wire. | Integer minor units; JSON numbers. | None material: guarantees exact 2dp arithmetic and the 0.01 sum invariant, avoids float drift. |
| **ADR-6** | **Prisma in Lambda / cold start** — cache `PrismaClient` across warm invocations and bundle the matching engine binary (`rhel-openssl-3.0.x`). | Reconnect per request. | Cold-start latency from engine load; mitigated by caching / provisioned concurrency. |
| **ADR-7** | **DB-backed lockout** — persist login-attempt/lock state in PostgreSQL so lockout is consistent across stateless containers. | ElastiCache / DynamoDB. | Extra DB writes on failed logins; acceptable at this volume. |
| **ADR-8** | **Consistent response envelope + global filter** — one success/error envelope enforced globally. | Per-controller shaping. | Slight coupling of controllers to the envelope shape; guarantees cross-endpoint consistency. |

Two further deterministic conventions are adopted where the requirements are
silent, documented alongside the ADRs:

- **Monday ISO week-start.** `weekly` budget windows run **Monday..Sunday**
  (ISO-8601), chosen as a documented, deterministic convention; `monthly` and
  `yearly` map to the calendar month/year, all bounds inclusive and evaluated in
  `PLATFORM_TIMEZONE`.
- **`SET NULL` for `Budget.categoryId`.** The design mandates `RESTRICT` only for
  `Expense → Category`; `Budget → Category` uses `ON DELETE SET NULL`, so
  deleting a category converts an affected budget into an unscoped
  (all-categories) budget rather than deleting it or blocking the delete (see
  [Constraints and `onDelete` rules](#constraints-and-ondelete-rules)).

### Tradeoffs

The decisions above are deliberate engineering tradeoffs. The ones most worth
calling out:

- **Single codebase vs. adapter dependency (ADR-1).** Running one Nest app in
  two targets removes an entire class of "works locally, breaks on Lambda" bugs,
  at the cost of a thin serverless-express dependency and taking care that any
  new global wiring goes through `configureApp()` rather than a
  per-environment path.
- **Stateless JWTs vs. revocability (ADR-4).** Statelessness fits Lambda and
  needs no session store, but a token stays valid until it expires. With a
  1-hour lifetime and no denylist/refresh flow in v1, a compromised token cannot
  be revoked early — a documented limitation, with short access + refresh tokens
  or a denylist as the recommended future enhancement (see
  [Using the token](#using-the-token)).
- **Decimal-as-string money (ADR-5).** Sending money as a string is slightly
  less convenient for naive clients than a JSON number, but it is the reason the
  analytics/budget totals are exact to 0.01 and never drift — a tradeoff made
  once, globally, rather than defended at every endpoint.
- **DB-backed lockout vs. a cache (ADR-7).** PostgreSQL keeps lockout correct
  across stateless containers with no extra infrastructure, at the cost of a
  small write on each failed login; a dedicated cache (ElastiCache/DynamoDB)
  would lower latency if login volume grew.
- **In-memory throttler vs. gateway throttling.** The per-container
  `ThrottlerGuard` (100/60s) is best-effort per warm container by design; **API
  Gateway throttling** is the authoritative, shared-state production layer (see
  [Security](#security)).
- **HTTP API vs. REST API (ADR-2).** Choosing the HTTP API keeps latency and
  cost down and matches in-app validation, but gives up REST-API features like
  usage plans, API keys, and tighter WAF integration should they be needed later.

## Ambiguities & risk resolutions

The requirements leave a handful of areas under-specified, and the serverless
runtime introduces a few technical risks. The design captured these in its
**§Ambiguities and Technical Risks** list; each is reproduced here with the
resolution actually adopted in this codebase. These are **labeled engineering
recommendations**, not derived requirements — where a choice was made, the
tradeoff is stated so it can be revisited later.

| # | Ambiguity / risk | Resolution adopted | Follow-up / future work |
| --- | ---------------- | ------------------ | ----------------------- |
| 1 | **Token revocation / logout not specified.** JWTs stay valid until the 3600s expiry (Req 2.4). | Accept short-lived stateless tokens as-is for v1 (**ADR-4**); a compromised token cannot be revoked before it expires. | Add a token denylist or switch to short access + refresh tokens if early revocation becomes a requirement. |
| 2 | **Refresh tokens not mentioned.** With a 1-hour expiry and no refresh flow, clients must re-authenticate. | Documented as a v1 limitation — clients re-login when the token expires (see [Using the token](#using-the-token)). | Introduce a refresh-token flow in a future version. |
| 3 | **Currency handling (A2).** Currency is per-expense with no conversion, so a mixed-currency total is a numeric sum only. | Store currency per expense and perform **no conversion**; surface currency in insight responses and document that totals assume a single currency per user (see [Money as a string and mixed currency](#money-as-a-string-and-mixed-currency)). | Compute analytics/budgets per currency, or add an FX layer, if multi-currency reporting is needed. |
| 4 | **Time zone handling (A3).** Month/period boundaries depend on the configured zone; date-only dates vs. timestamp bounds can shift a record between months. | Evaluate every window in a **single configured `PLATFORM_TIMEZONE`** and store expense `date` as a date (no time), making the zone explicit in config (see [Configuration](#configuration)). | Support per-user time zones if households span regions. |
| 5 | **Lockout state in stateless Lambda.** A naive in-memory counter fails across containers (Req 2.7 would pass intermittently). | **DB-backed lockout** — persist login-attempt/lock state in PostgreSQL so it is consistent across stateless containers (**ADR-7**); a compact `LoginAttempt` table with stale-window cleanup keeps writes small (see [Lockout policy](#lockout-policy)). | Move to a dedicated cache (ElastiCache/DynamoDB) if login volume grows and write latency matters. |
| 6 | **Prisma cold-start latency.** Engine load + first DB connect can push cold requests toward timing budgets (e.g. Req 2.1's 2s). | **Cache `PrismaClient`** across warm invocations and bundle the matching engine binary (**ADR-6**); treat timing criteria as **warm-path targets** and right-size Lambda memory. | Enable **provisioned concurrency** on the auth endpoints to keep cold requests within budget. |
| 7 | **Connection exhaustion under high concurrency.** Many warm Lambdas × per-container connections can exceed RDS limits. | **RDS Proxy** (recommended) plus a small per-client pool (`connection_limit=1..3`) to pool and cap connections (**ADR-3**). | Tune pool size / proxy limits against observed concurrency; scale the DB tier if sustained load rises. |
| 8 | **DB-unavailability behavior (Req 16.4).** The 10s connect bound must be enforced explicitly and mapped to a stable error. | Bound connection attempts to a **10s timeout** and map the failure to a **`DB_UNAVAILABLE` 503** rather than hanging; verify the effective timeout in both local and Lambda (VPC) networking. | Add health-based circuit breaking / retry-with-backoff for transient outages. |
| 9 | **Idempotency of writes not specified.** Clients that retry on a Lambda timeout could create duplicate expenses. | Documented as a known gap for v1 — writes are **not idempotent** by default. | Accept an idempotency key on `POST` and de-duplicate retried writes if clients retry aggressively. |
| 10 | **"Consecutive" failed attempts (Req 2.7).** Whether a successful login resets the counter was implied, not explicit. | Reset the failure counter on **any successful authentication** and on **window expiry**, so only truly consecutive failures count toward lockout (see [Lockout policy](#lockout-policy)). | — |
| 11 | **Amount lower-bound discrepancy.** Req 4.1 uses `> 0.00` while Req 6.1/9.1/11.5 use `0.01`. | Treat **`0.01` as the effective minimum everywhere** for two-decimal money and document the equivalence — the smallest representable positive `Decimal(12,2)` is `0.01`, so `> 0.00` and `>= 0.01` coincide (see [Validation rules](#validation-rules)). | — |

### Interview discussion notes

A few decisions are worth highlighting on their own, both because they shaped the
rest of the design and because they are the natural places to extend the system.

- **One codebase, two runtimes.** The single biggest lever is running the *same*
  Nest app locally and on Lambda via one `configureApp()` bootstrap (**ADR-1**).
  It removes an entire class of "works locally, breaks in the cloud" bugs. The
  discipline it demands: every new global concern (guards, pipes, filters,
  interceptors) must go through `configureApp()` rather than a per-environment
  path.
- **Statelessness vs. revocability (ADR-4).** JWTs fit the stateless Lambda model
  with no session store, but the tradeoff is real — a token stays valid for up to
  an hour with no way to revoke it early in v1. If asked "what would you do
  next?", the answer is a short access token + refresh token, or a denylist keyed
  on token ID, accepting the extra state that reintroduces.
- **Exact money, decided once (ADR-5).** Money is `Decimal(12,2)` end-to-end and
  serialized as a two-decimal **string**. It is slightly less convenient for a
  naive client than a JSON number, but it is precisely why the analytics/budget
  sums are exact to `0.01` and never drift, and it makes the `0.01` lower-bound
  (item 11) fall out naturally. The invariant is enforced once, globally, instead
  of being re-argued at every endpoint.
- **Correctness across stateless containers (ADR-7).** Lockout is the clearest
  example of a feature that *looks* trivial but breaks under serverless
  concurrency. Persisting attempt state in PostgreSQL keeps Req 2.7 correct with
  no extra infrastructure; a cache is the scale-up path, not the starting point.
- **Cold start as a warm-path contract (ADR-6).** Rather than pretend cold starts
  don't exist, the timing criteria are treated as warm-path targets, the Prisma
  client is cached, and provisioned concurrency is the documented knob for
  pulling cold auth requests inside the budget. It is an honest, measurable
  contract rather than an aspirational one.
- **How I'd extend it.** The highest-value next steps map directly onto the table
  above: refresh tokens + revocation (items 1–2), per-currency analytics
  (item 3), idempotency keys on writes (item 9), and RDS Proxy + provisioned
  concurrency turned on in the deployed stack (items 6–7). Each is already
  anticipated in the design, so none requires re-architecting the core.
