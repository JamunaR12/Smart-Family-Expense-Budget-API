import * as fc from 'fast-check';
import { validateEnv } from '../../src/config/env.validation';

/**
 * // Feature: smart-expense-insights-platform, Property 32
 *
 * Property 32: Configuration fail-fast (Req 15.2, 15.3, 15.5).
 *
 * PURE / NO-DB. Uses the REAL {@link validateEnv} (Zod) — nothing is
 * re-implemented. For any required configuration key that is absent, empty,
 * whitespace-only, or present but failing type validation, `validateEnv` SHALL
 * throw and the thrown error message SHALL NAME each offending key (and, for
 * type failures, include the expected-type hint). For a fully-valid environment
 * it returns the typed config with defaults applied.
 */
describe('Property 32 — configuration fail-fast (Req 15.2, 15.3, 15.5)', () => {
  /** A minimal, fully-valid base environment. */
  const validBase = (): Record<string, string> => ({
    RUNTIME_ENV: 'local',
    PORT: '3000',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(16),
  });

  const REQUIRED_KEYS = [
    'RUNTIME_ENV',
    'PORT',
    'DATABASE_URL',
    'JWT_SECRET',
  ] as const;

  it('valid environment returns typed config with defaults applied', () => {
    const config = validateEnv(validBase());

    expect(config.RUNTIME_ENV).toBe('local');
    expect(config.PORT).toBe(3000);
    expect(config.DATABASE_URL).toBe('postgresql://u:p@localhost:5432/db');
    expect(config.JWT_SECRET).toBe('x'.repeat(16));
    // Defaults applied.
    expect(config.JWT_EXPIRES_IN).toBe(3600);
    expect(config.PLATFORM_TIMEZONE).toBe('UTC');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.LOGIN_MAX_ATTEMPTS).toBe(5);
    expect(config.LOGIN_WINDOW_MINUTES).toBe(15);
    expect(config.LOGIN_LOCKOUT_SECONDS).toBe(900);
    // CORS_ORIGINS is optional: unset is OK.
    expect(config.CORS_ORIGINS).toBeUndefined();
  });

  it('any required key that is missing/empty/whitespace-only causes a throw naming that key', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...REQUIRED_KEYS),
        // "missing-ness" variants: delete the key, blank it, or whitespace it.
        fc.constantFrom<'delete' | 'empty' | 'whitespace'>(
          'delete',
          'empty',
          'whitespace',
        ),
        (key, variant) => {
          const env = validBase() as Record<string, string>;
          if (variant === 'delete') {
            delete env[key];
          } else if (variant === 'empty') {
            env[key] = '';
          } else {
            env[key] = '   ';
          }

          let thrown: Error | undefined;
          try {
            validateEnv(env);
          } catch (e) {
            thrown = e as Error;
          }

          expect(thrown).toBeInstanceOf(Error);
          // The single aggregated error names the offending key.
          expect(thrown?.message).toContain(key);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('type-invalid values throw naming the key and include the expected-type hint', () => {
    // Fixed, representative type-invalid cases (explicit examples are fine here).
    const cases: Array<{ key: string; value: string; expectedHint: string }> = [
      { key: 'PORT', value: 'abc', expectedHint: 'positive integer' },
      { key: 'PORT', value: '-1', expectedHint: 'positive integer' },
      { key: 'RUNTIME_ENV', value: 'prod', expectedHint: 'enum(local|aws)' },
      {
        key: 'LOG_LEVEL',
        value: 'verbose',
        expectedHint: 'enum(debug|info|warn|error)',
      },
    ];

    for (const { key, value, expectedHint } of cases) {
      const env = validBase() as Record<string, string>;
      env[key] = value;

      let thrown: Error | undefined;
      try {
        validateEnv(env);
      } catch (e) {
        thrown = e as Error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown?.message).toContain(key);
      expect(thrown?.message).toContain(expectedHint);
    }
  });

  it('multi-key breakage: a single thrown error names ALL offending keys (aggregation)', () => {
    fc.assert(
      fc.property(
        // Choose 2+ distinct required keys to break at once.
        fc.uniqueArray(fc.constantFrom(...REQUIRED_KEYS), {
          minLength: 2,
          maxLength: REQUIRED_KEYS.length,
        }),
        fc.constantFrom<'delete' | 'empty' | 'whitespace'>(
          'delete',
          'empty',
          'whitespace',
        ),
        (keys, variant) => {
          const env = validBase() as Record<string, string>;
          for (const key of keys) {
            if (variant === 'delete') {
              delete env[key];
            } else if (variant === 'empty') {
              env[key] = '';
            } else {
              env[key] = '   ';
            }
          }

          let thrown: Error | undefined;
          try {
            validateEnv(env);
          } catch (e) {
            thrown = e as Error;
          }

          expect(thrown).toBeInstanceOf(Error);
          // Every broken key is named in the single aggregated error.
          for (const key of keys) {
            expect(thrown?.message).toContain(key);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
