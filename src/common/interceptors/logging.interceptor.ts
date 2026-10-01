import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { getCorrelationId } from '../logging/correlation-context';
import { LogLevel, StructuredLogger, redact } from '../logging/logger';

/**
 * Per-request structured logging interceptor (Req 14.1, 14.2, 14.3, 14.6).
 *
 * Registered globally in `configureApp()` so BOTH runtime targets (local
 * `app.listen()` and the Lambda `serverless-express` proxy) emit identical
 * structured request logs (Req 16.5). For EVERY request it emits exactly one
 * structured entry containing:
 *  - the request `method`,
 *  - the target `route` (the matched route pattern when available, e.g.
 *    `/api/v1/expenses/:id`, otherwise the request path — never the raw query
 *    string),
 *  - the response `status` code,
 *  - the `correlationId` (read from the request-scoped context populated by
 *    `CorrelationIdMiddleware`, which generates one when the client omits it —
 *    Req 14.6),
 *  - a millisecond-precision ISO `timestamp` (produced by `StructuredLogger`),
 *  - a severity `level` from {DEBUG, INFO, WARN, ERROR} (Req 14.2),
 *  - and `durationMs` (elapsed handler time).
 *
 * On success it emits an INFO entry; on error it emits an ERROR entry that also
 * carries the error `category` (the exception's code/name) alongside the
 * correlation id and route (Req 14.3), then re-throws so the global
 * `AllExceptionsFilter` still shapes the response.
 *
 * SECRET SAFETY (Req 14.4, 14.5): the interceptor logs ONLY safe metadata
 * (method, route, status, correlationId, durationMs, and — on error — the error
 * category). It never logs request bodies, headers, or the Authorization token,
 * which is the strongest way to guarantee no raw secret can appear in a log
 * field. As a defense-in-depth belt-and-braces measure the assembled context is
 * still passed through the shared `redact()` serializer before emission, so any
 * future addition of a sensitive key would be scrubbed to the placeholder.
 *
 * NOTE (design deviation, intentional): the design mentions a companion
 * `ResponseEnvelopeInterceptor`. It is deliberately NOT added here — the current
 * success responses are already shaped by the controllers/services (and the
 * existing controller/e2e tests assert those shapes), so wrapping successes in a
 * new envelope now would break them. Only the `LoggingInterceptor` is wired.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new StructuredLogger();

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const method = request.method;
    const route = this.resolveRoute(request);
    const correlationId = getCorrelationId();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        this.emit(LogLevel.INFO, 'request.completed', {
          method,
          route,
          status: response.statusCode,
          correlationId,
          durationMs: Date.now() - startedAt,
        });
      }),
      catchError((error: unknown) => {
        this.emit(LogLevel.ERROR, 'request.failed', {
          method,
          route,
          status: this.statusFor(error, response),
          category: this.categoryFor(error),
          correlationId,
          durationMs: Date.now() - startedAt,
        });
        return throwError(() => error);
      }),
    );
  }

  /**
   * Prefers the matched route pattern (`req.route.path`, e.g. `/expenses/:id`)
   * so ids and other path params are not logged verbatim; falls back to the
   * request path (without the query string) when no route is matched (e.g. a
   * 404). Never includes the query string, so query-borne values cannot leak.
   */
  private resolveRoute(request: Request): string {
    const matched = (request as Request & { route?: { path?: string } }).route
      ?.path;
    if (typeof matched === 'string' && matched.length > 0) {
      return matched;
    }
    const original = request.originalUrl ?? request.url ?? '';
    const queryStart = original.indexOf('?');
    return queryStart >= 0 ? original.slice(0, queryStart) : original;
  }

  /**
   * Derives the response status for an error entry: an `HttpException` carries
   * its own status; anything else is treated as a 500 (the value the
   * `AllExceptionsFilter` will ultimately return).
   */
  private statusFor(error: unknown, response: Response): number {
    if (error instanceof HttpException) {
      return error.getStatus();
    }
    // For non-HttpException errors the response has not been sent yet; the
    // global filter maps these to 500.
    return response.statusCode >= 500 ? response.statusCode : 500;
  }

  /**
   * Extracts a coarse, non-sensitive error category (Req 14.3): the in-envelope
   * `code` when present, else the exception class name, else the generic
   * `INTERNAL_ERROR`. Never includes messages, stacks, or payloads.
   */
  private categoryFor(error: unknown): string {
    if (error instanceof HttpException) {
      const res = error.getResponse();
      if (
        typeof res === 'object' &&
        res !== null &&
        typeof (res as Record<string, unknown>).code === 'string'
      ) {
        return (res as Record<string, unknown>).code as string;
      }
      return error.constructor.name;
    }
    if (error instanceof Error) {
      return error.name;
    }
    return 'INTERNAL_ERROR';
  }

  /**
   * Emits a single structured entry. The context is passed through `redact()`
   * (defense-in-depth) even though only safe metadata is included, guaranteeing
   * no raw secret can ever appear in a log field (Req 14.4, 14.5).
   */
  private emit(
    level: LogLevel,
    message: string,
    context: Record<string, unknown>,
  ): void {
    const safeContext = redact(context) as Record<string, unknown>;
    switch (level) {
      case LogLevel.ERROR:
        this.logger.error(message, safeContext);
        break;
      case LogLevel.WARN:
        this.logger.warn(message, safeContext);
        break;
      case LogLevel.DEBUG:
        this.logger.debug(message, safeContext);
        break;
      default:
        this.logger.info(message, safeContext);
    }
  }
}
