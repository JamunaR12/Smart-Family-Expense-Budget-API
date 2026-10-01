/**
 * Structured JSON logging skeleton.
 *
 * Backs Requirement 14:
 * - 14.1: emits structured entries (the request-logging interceptor in task 8.1
 *   will add method/route/status/correlationId — this module provides the
 *   underlying structured emitter + timestamp + level).
 * - 14.2: every entry carries a severity from {DEBUG, INFO, WARN, ERROR}.
 * - 14.4/14.5 (groundwork): a redaction serializer replaces sensitive values
 *   with a fixed placeholder before emission. The full interceptor wiring is
 *   task 8.1; this module provides the reusable redaction helper.
 */

/** Log severity levels (Req 14.2). */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

/** Fixed placeholder substituted for any redacted secret value (Req 14.5). */
export const REDACTION_PLACEHOLDER = '[REDACTED]';

/**
 * Object keys whose values are considered secrets and must never appear in a
 * log entry (Req 14.4). Matched case-insensitively as a substring so variants
 * like `Authorization`, `accessToken`, or `jwtSecret` are also caught.
 */
export const SENSITIVE_KEYS: readonly string[] = [
  'password',
  'authorization',
  'token',
  'secret',
  'jwt',
  'apikey',
  'api_key',
  'cookie',
];

/** A structured log entry as emitted to stdout. */
export interface LogEntry {
  /** ISO 8601 timestamp with millisecond precision. */
  timestamp: string;
  /** Severity level (Req 14.2). */
  level: LogLevel;
  /** Human-readable message. */
  message: string;
  /** Correlation id shared by all entries for a request (Req 14.6), when known. */
  correlationId?: string;
  /** Arbitrary structured context (redacted before emission). */
  context?: Record<string, unknown>;
}

/** Returns true when `key` names a sensitive value (case-insensitive substring). */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((sensitive) => lower.includes(sensitive));
}

/**
 * Recursively replaces the value of any sensitive key with the fixed redaction
 * placeholder (Req 14.4, 14.5). Non-sensitive values are preserved. Arrays and
 * nested objects are traversed; cycles are guarded against.
 */
export function redact(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value as object)) {
    return '[Circular]';
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isSensitiveKey(key)
      ? REDACTION_PLACEHOLDER
      : redact(val, seen);
  }
  return result;
}

/**
 * Minimal structured JSON logger.
 *
 * Emits one JSON object per line to stdout (INFO/DEBUG/WARN) or stderr (ERROR),
 * with an ISO millisecond-precision timestamp and a severity level. Context is
 * passed through the redaction serializer before emission.
 *
 * This is the Phase 1 skeleton; the request-logging interceptor (task 8.1) will
 * build on top of it to record method/route/status per request.
 */
export class StructuredLogger {
  constructor(private readonly correlationId?: string) {}

  /** Returns a logger bound to a specific correlation id (Req 14.6). */
  withCorrelationId(correlationId: string): StructuredLogger {
    return new StructuredLogger(correlationId);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.WARN, message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.ERROR, message, context);
  }

  private emit(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (this.correlationId) {
      entry.correlationId = this.correlationId;
    }

    if (context) {
      entry.context = redact(context) as Record<string, unknown>;
    }

    const line = JSON.stringify(entry);
    if (level === LogLevel.ERROR) {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  }
}
