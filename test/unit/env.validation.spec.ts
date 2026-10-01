import { validateEnv } from '../../src/config/env.validation';

/**
 * Unit tests for the fail-fast environment configuration validator
 * (Task 1.6). Covers Requirement 15:
 *  - 15.2: missing values terminate startup and the error names each key.
 *  - 15.3: empty / whitespace-only values are treated as missing and named.
 *  - 15.5: type/format failures name the key AND the expected type.
 *  - aggregation: a single thrown error names ALL offending keys at once.
 */
describe('validateEnv (Req 15.2, 15.3, 15.5)', () => {
  /** A complete, valid raw environment with only the required keys set. */
  const validEnv = (): Record<string, unknown> => ({
    RUNTIME_ENV: 'local',
    PORT: '3000',
    DATABASE_URL: 'postgresql://user:password@localhost:5432/expense_dev',
    JWT_SECRET: 'a-strong-secret',
  });

  describe('valid configuration', () => {
    it('parses a valid env and applies documented defaults', () => {
      const config = validateEnv(validEnv());

      expect(config.RUNTIME_ENV).toBe('local');
      expect(config.PORT).toBe(3000);
      expect(config.DATABASE_URL).toBe(
        'postgresql://user:password@localhost:5432/expense_dev',
      );
      expect(config.JWT_SECRET).toBe('a-strong-secret');

      // Defaults (Req 15 defaults per env.validation.ts).
      expect(config.JWT_EXPIRES_IN).toBe(3600);
      expect(config.PLATFORM_TIMEZONE).toBe('UTC');
      expect(config.LOG_LEVEL).toBe('info');
      expect(config.LOGIN_MAX_ATTEMPTS).toBe(5);
      expect(config.LOGIN_WINDOW_MINUTES).toBe(15);
      expect(config.LOGIN_LOCKOUT_SECONDS).toBe(900);
    });

    it('coerces numeric strings to numbers and honors explicit overrides', () => {
      const config = validateEnv({
        ...validEnv(),
        JWT_EXPIRES_IN: '7200',
        LOG_LEVEL: 'debug',
        LOGIN_MAX_ATTEMPTS: '10',
      });

      expect(config.JWT_EXPIRES_IN).toBe(7200);
      expect(config.LOG_LEVEL).toBe('debug');
      expect(config.LOGIN_MAX_ATTEMPTS).toBe(10);
    });
  });

  describe('missing required keys (Req 15.2)', () => {
    it('throws and names every absent required key', () => {
      let caught: Error | undefined;
      try {
        validateEnv({}); // nothing provided
      } catch (error) {
        caught = error as Error;
      }

      expect(caught).toBeInstanceOf(Error);
      const message = caught!.message;
      expect(message).toContain('RUNTIME_ENV');
      expect(message).toContain('PORT');
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('JWT_SECRET');
    });

    it('names a single missing key when only one is absent', () => {
      const env = validEnv();
      delete env.JWT_SECRET;

      expect(() => validateEnv(env)).toThrow(/JWT_SECRET/);
    });
  });

  describe('empty and whitespace-only values (Req 15.3)', () => {
    it('treats an empty-string required value as missing and names it', () => {
      expect(() => validateEnv({ ...validEnv(), DATABASE_URL: '' })).toThrow(
        /DATABASE_URL/,
      );
    });

    it('treats a whitespace-only required value as missing and names it', () => {
      expect(() => validateEnv({ ...validEnv(), JWT_SECRET: '   ' })).toThrow(
        /JWT_SECRET/,
      );
    });
  });

  describe('type-invalid values name the key and expected type (Req 15.5)', () => {
    it('rejects a non-numeric PORT and mentions the expected type', () => {
      let caught: Error | undefined;
      try {
        validateEnv({ ...validEnv(), PORT: 'abc' });
      } catch (error) {
        caught = error as Error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught!.message).toContain('PORT');
      expect(caught!.message).toContain('positive integer');
    });

    it('rejects an out-of-enum RUNTIME_ENV and mentions the expected type', () => {
      let caught: Error | undefined;
      try {
        validateEnv({ ...validEnv(), RUNTIME_ENV: 'prod' });
      } catch (error) {
        caught = error as Error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught!.message).toContain('RUNTIME_ENV');
      expect(caught!.message).toContain('local');
      expect(caught!.message).toContain('aws');
    });

    it('rejects an out-of-enum LOG_LEVEL and mentions the expected type', () => {
      let caught: Error | undefined;
      try {
        validateEnv({ ...validEnv(), LOG_LEVEL: 'verbose' });
      } catch (error) {
        caught = error as Error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught!.message).toContain('LOG_LEVEL');
      expect(caught!.message).toMatch(/debug|info|warn|error/);
    });
  });

  describe('aggregation of multiple problems', () => {
    it('reports every offending key in a single thrown error', () => {
      let caught: Error | undefined;
      try {
        validateEnv({
          // RUNTIME_ENV missing
          PORT: 'abc', // type-invalid
          DATABASE_URL: '   ', // whitespace-only -> missing
          // JWT_SECRET missing
        });
      } catch (error) {
        caught = error as Error;
      }

      expect(caught).toBeInstanceOf(Error);
      const message = caught!.message;
      expect(message).toContain('RUNTIME_ENV');
      expect(message).toContain('PORT');
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('JWT_SECRET');
    });
  });
});
