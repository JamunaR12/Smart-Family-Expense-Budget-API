import { z } from 'zod';

/**
 * Environment configuration schema and fail-fast validation.
 *
 * Satisfies Requirement 15 (Environment-Based Configuration):
 * - 15.1: config is read/validated before the app accepts requests (wired via
 *   `ConfigModule.forRoot({ validate })` in `config.module.ts`).
 * - 15.2/15.3: on any missing/empty/whitespace/type-invalid value, startup
 *   terminates and the emitted error NAMES each offending configuration key.
 * - 15.4: secrets (JWT_SECRET, DATABASE_URL) are sourced from configuration,
 *   never hardcoded.
 * - 15.5: on a type/format failure the error names the key AND the expected type.
 *
 * All errors are aggregated (Zod does not stop at the first issue) so a single
 * startup attempt reports every offending key at once.
 */

/** Runtime environment: selects the bootstrap path (local listen vs Lambda handler). */
export const RUNTIME_ENVIRONMENTS = ['local', 'aws'] as const;
export type RuntimeEnvironment = (typeof RUNTIME_ENVIRONMENTS)[number];

/** Supported log severity levels (Req 14.2). */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Treats empty-string / whitespace-only values as "missing" so that a blank
 * env var fails the same way an absent one does (Req 15.2). Applied to every
 * string-backed field via preprocessing.
 */
const blankToUndefined = (value: unknown): unknown => {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
};

/** A required, non-empty (after trimming) string. */
const requiredString = (): z.ZodType<string> =>
  z.preprocess(blankToUndefined, z.string().trim().min(1));

/**
 * A required non-negative integer parsed from an env string. Reports the
 * expected type on failure (Req 15.5).
 */
const numericFromString = (): z.ZodType<number> =>
  z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ message: 'Expected a numeric value' })
      .int('Expected an integer')
      .nonnegative('Expected a non-negative integer'),
  );

/**
 * A positive integer parsed from an env string (used for ports/durations that
 * must be >= 1).
 */
const positiveNumericFromString = (): z.ZodType<number> =>
  z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ message: 'Expected a numeric value' })
      .int('Expected an integer')
      .positive('Expected a positive integer'),
  );

export const envSchema = z.object({
  // Selects bootstrap path (local listen() vs Lambda handler) — consumed by task 1.4.
  RUNTIME_ENV: z.preprocess(
    blankToUndefined,
    z.enum(RUNTIME_ENVIRONMENTS, {
      message: `Expected one of: ${RUNTIME_ENVIRONMENTS.join(', ')}`,
    }),
  ),

  // Local HTTP port (Req 16.1). Required; validated as a positive integer.
  PORT: positiveNumericFromString(),

  // PostgreSQL connection string (C3, C6, Req 15.4).
  DATABASE_URL: requiredString(),

  // JWT signing secret — never hardcoded (Req 15.4).
  JWT_SECRET: requiredString(),

  // Token lifetime in seconds; design target is 3600 (Req 2.4).
  JWT_EXPIRES_IN: numericFromString().default(3600),

  // Single configured platform time zone for date grouping (A3).
  PLATFORM_TIMEZONE: requiredString().default('UTC'),

  // Log severity threshold (Req 14.2).
  LOG_LEVEL: z
    .preprocess(
      blankToUndefined,
      z.enum(LOG_LEVELS, {
        message: `Expected one of: ${LOG_LEVELS.join(', ')}`,
      }),
    )
    .default('info'),

  // Lockout parameters (Req 2.7).
  LOGIN_MAX_ATTEMPTS: positiveNumericFromString().default(5),
  LOGIN_WINDOW_MINUTES: positiveNumericFromString().default(15),
  LOGIN_LOCKOUT_SECONDS: positiveNumericFromString().default(900),

  // Optional comma-separated list of allowed CORS origins (task 8.2). Optional:
  // an unset/blank value MUST NOT fail startup. When absent, cross-origin access
  // is disabled by a safe default in `configureApp()` (never `'*'`). Parsing +
  // wiring live in `configureApp()`; kept optional here so it is a documented,
  // validated key without being a startup requirement.
  CORS_ORIGINS: z.preprocess(blankToUndefined, z.string().trim().optional()),
});

/** The validated, typed application configuration shape. */
export type AppConfig = z.infer<typeof envSchema>;

/**
 * Human-readable expected-type hint per key, appended to type/format failures
 * so the emitted startup error names the expected type (Req 15.5).
 */
const EXPECTED_TYPES: Record<string, string> = {
  RUNTIME_ENV: `enum(${RUNTIME_ENVIRONMENTS.join('|')})`,
  PORT: 'positive integer',
  DATABASE_URL: 'non-empty string',
  JWT_SECRET: 'non-empty string',
  JWT_EXPIRES_IN: 'non-negative integer (seconds)',
  PLATFORM_TIMEZONE: 'non-empty string',
  LOG_LEVEL: `enum(${LOG_LEVELS.join('|')})`,
  LOGIN_MAX_ATTEMPTS: 'positive integer',
  LOGIN_WINDOW_MINUTES: 'positive integer',
  LOGIN_LOCKOUT_SECONDS: 'positive integer',
  CORS_ORIGINS: 'optional comma-separated list of origins',
};

/**
 * Validates the raw environment and fails fast on any problem.
 *
 * Aggregates ALL issues (missing, empty/whitespace, or type-invalid) and throws
 * a single error naming every offending key, including the expected type for
 * type/format failures (Req 15.2, 15.3, 15.5).
 *
 * @param config the raw environment object (e.g. `process.env`)
 * @returns the validated, typed and defaulted configuration
 * @throws Error listing every offending configuration key
 */
export function validateEnv(config: Record<string, unknown>): AppConfig {
  const result = envSchema.safeParse(config);

  if (result.success) {
    return result.data;
  }

  const lines = result.error.issues.map((issue) => {
    const key = issue.path.length > 0 ? String(issue.path[0]) : '(root)';
    const expected = EXPECTED_TYPES[key];
    const expectedSuffix = expected ? ` (expected ${expected})` : '';
    return `  - ${key}: ${issue.message}${expectedSuffix}`;
  });

  throw new Error(
    `Invalid environment configuration. The following configuration keys are missing or invalid:\n${lines.join('\n')}`,
  );
}
