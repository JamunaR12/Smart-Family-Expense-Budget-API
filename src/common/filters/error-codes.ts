/**
 * Machine-readable error-code catalog (design §Error Handling).
 *
 * Every error the Platform returns carries one of these codes in the consistent
 * error envelope so clients can branch on a stable, human-independent value
 * (Req 13.1). Services and guards already throw HttpExceptions whose response
 * bodies embed these codes; the {@link AllExceptionsFilter} reuses them and
 * assigns one when an exception does not already carry one.
 *
 * Kept as a single source of truth so the same string constants are shared by
 * the filter, the services, and the property/unit tests (Property 27).
 */
export const ERROR_CODES = {
  /** A request payload / parameter failed field-level validation (Req 12, 13.4). */
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  /** A protected route was reached without an Authentication_Token (Req 3.4). */
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  /** A token was present but expired/malformed/invalid, or credentials were wrong (Req 2.2, 2.5, 2.6, 3.5). */
  AUTH_FAILED: 'AUTH_FAILED',
  /** The account is temporarily locked after repeated failed logins (Req 2.7). */
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  /** The authenticated user is not permitted to perform the operation (Req 3.2). */
  FORBIDDEN: 'FORBIDDEN',
  /** The requested resource does not exist (or is not owned — non-disclosing) (Req 3.2, 5.7). */
  NOT_FOUND: 'NOT_FOUND',
  /** A uniqueness or dependency conflict (Req 1.2, 8.3, 8.7). */
  CONFLICT: 'CONFLICT',
  /** The database could not be reached within the bounded timeout (Req 16.4). */
  DB_UNAVAILABLE: 'DB_UNAVAILABLE',
  /** An unexpected internal failure; response leaks no internals (Req 13.2). */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

/** Union of all valid machine-readable error codes. */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Maximum length of a human-readable error message in the envelope (Req 13.1).
 * Messages are truncated to this bound before emission.
 */
export const MAX_ERROR_MESSAGE_LENGTH = 500;
