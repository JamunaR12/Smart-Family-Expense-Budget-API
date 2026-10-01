import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { getCorrelationId } from '../logging/correlation-context';
import { StructuredLogger } from '../logging/logger';
import {
  ERROR_CODES,
  ErrorCode,
  MAX_ERROR_MESSAGE_LENGTH,
} from './error-codes';

/** A single field-level failure detail in a validation error (Req 13.4). */
export interface ErrorDetail {
  field: string;
  reason: string;
}

/** The `error` block of the consistent error envelope (Req 13.1). */
export interface ErrorBody {
  code: string;
  message: string;
  details?: ErrorDetail[];
}

/**
 * The single, consistent error envelope returned by EVERY endpoint (Req 13.1).
 *
 * Field names and structure are identical across all endpoints (Property 27):
 * a boolean `success` flag (always `false` here), an `error` block carrying a
 * machine-readable `code`, a human-readable `message` (<=500 chars), and an
 * optional `details[]` of `{ field, reason }`; plus a `meta` block echoing the
 * request correlation id (Req 14.6) — `null` when none is present.
 */
export interface ErrorEnvelope {
  success: false;
  error: ErrorBody;
  meta: { correlationId: string | null };
}

/** Shape of the object payload our services/guards throw inside HttpExceptions. */
interface InEnvelopePayload {
  code: string;
  message: string;
  details?: ErrorDetail[];
}

/**
 * Global exception filter — the single edge that converts EVERY thrown error
 * into the consistent error envelope (design §Error Handling, Req 13.1-13.3).
 *
 * Registered once in `configureApp()` so local and Lambda return byte-for-byte
 * identical error responses (Req 16.5). It NEVER mutates the payloads services
 * or guards throw — it only reshapes the HTTP response at the boundary, so the
 * service-level unit/property tests that assert thrown-exception shapes stay
 * valid.
 *
 * Mapping rules:
 * - HttpException whose response is ALREADY our `{ code, message, details? }`
 *   object (services + guards + the ValidationPipe exceptionFactory): reuse its
 *   code/message/details and take the HTTP status from the exception (Req 13.1,
 *   13.3, 13.4).
 * - HttpException with Nest's DEFAULT shape (`{ statusCode, message, error }`):
 *   normalize to a code inferred from the status and a concise message; for a
 *   400 this collapses to `VALIDATION_ERROR` (Req 13.4). This is a backstop —
 *   the ValidationPipe exceptionFactory already produces the in-envelope shape.
 * - Any non-HttpException / unexpected error: a GENERIC 500 `INTERNAL_ERROR`
 *   with a fixed message. The original error is logged server-side but NEVER
 *   echoed to the client, so stack traces, DB details, file paths, and secrets
 *   cannot leak (Req 13.2, Property 28).
 *
 * HTTP status class is preserved (4xx client / 5xx server, Req 13.3): an
 * HttpException's own status is passed through; anything else is a 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new StructuredLogger();

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const { status, body } = this.resolve(exception);

    const envelope: ErrorEnvelope = {
      success: false,
      error: body,
      meta: { correlationId: getCorrelationId() ?? null },
    };

    response.status(status).json(envelope);
  }

  /**
   * Resolves any thrown value into an HTTP status + error body, applying the
   * mapping rules documented on the class.
   */
  private resolve(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      return this.resolveHttpException(exception);
    }

    // Unexpected / non-HttpException: generic 500, no internals disclosed
    // (Req 13.2). Log the real error server-side (redacted) for diagnosis.
    this.logInternalError(exception);
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'An unexpected internal error occurred',
      },
    };
  }

  /** Maps an HttpException to the envelope body, preserving its status. */
  private resolveHttpException(exception: HttpException): {
    status: number;
    body: ErrorBody;
  } {
    const status = exception.getStatus();
    const res = exception.getResponse();

    // Case 1: our services/guards/exceptionFactory throw an in-envelope object.
    if (this.isInEnvelopePayload(res)) {
      const body: ErrorBody = {
        code: res.code,
        message: this.clampMessage(res.message),
      };
      if (Array.isArray(res.details) && res.details.length > 0) {
        body.details = res.details;
      }
      return { status, body };
    }

    // Case 2: Nest's default shape ({ statusCode, message, error }) or a bare
    // string — normalize to a code inferred from the status (Req 13.1, 13.3).
    const code = this.codeForStatus(status);
    const message = this.messageFromDefault(res, status);
    return { status, body: { code, message: this.clampMessage(message) } };
  }

  /** True when `res` is our `{ code, message }` envelope payload. */
  private isInEnvelopePayload(res: unknown): res is InEnvelopePayload {
    return (
      typeof res === 'object' &&
      res !== null &&
      typeof (res as Record<string, unknown>).code === 'string' &&
      typeof (res as Record<string, unknown>).message === 'string'
    );
  }

  /**
   * Infers a machine-readable code from an HTTP status for HttpExceptions that
   * did not carry one (backstop for Nest's default error shapes).
   */
  private codeForStatus(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ERROR_CODES.VALIDATION_ERROR;
      case HttpStatus.UNAUTHORIZED:
        return ERROR_CODES.AUTH_FAILED;
      case HttpStatus.FORBIDDEN:
        return ERROR_CODES.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ERROR_CODES.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ERROR_CODES.CONFLICT;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ERROR_CODES.DB_UNAVAILABLE;
      default:
        return status >= HttpStatus.INTERNAL_SERVER_ERROR
          ? ERROR_CODES.INTERNAL_ERROR
          : ERROR_CODES.VALIDATION_ERROR;
    }
  }

  /**
   * Extracts a concise human message from Nest's default exception response
   * shape (`{ statusCode, message, error }`) or a bare string. Never surfaces
   * more than a message string — no status codes or internal fields leak.
   */
  private messageFromDefault(res: unknown, status: number): string {
    if (typeof res === 'string') {
      return res;
    }
    if (typeof res === 'object' && res !== null) {
      const message = (res as Record<string, unknown>).message;
      if (typeof message === 'string') {
        return message;
      }
      if (Array.isArray(message)) {
        // Nest lists each failing constraint; join into one concise message.
        return message.filter((m) => typeof m === 'string').join('; ');
      }
      const error = (res as Record<string, unknown>).error;
      if (typeof error === 'string') {
        return error;
      }
    }
    return status >= HttpStatus.INTERNAL_SERVER_ERROR
      ? 'An unexpected internal error occurred'
      : 'Request failed';
  }

  /** Truncates a message to the envelope's maximum length (Req 13.1). */
  private clampMessage(message: string): string {
    return message.length > MAX_ERROR_MESSAGE_LENGTH
      ? message.slice(0, MAX_ERROR_MESSAGE_LENGTH)
      : message;
  }

  /**
   * Logs an unexpected error server-side for diagnosis. The structured logger's
   * redaction serializer strips known-sensitive values, and this data never
   * reaches the client response (Req 13.2, Req 14.4/14.5).
   */
  private logInternalError(exception: unknown): void {
    const context: Record<string, unknown> = {
      errorCategory: ERROR_CODES.INTERNAL_ERROR,
    };
    if (exception instanceof Error) {
      context.name = exception.name;
      context.message = exception.message;
      context.stack = exception.stack;
    } else {
      context.value = String(exception);
    }
    this.logger.error('Unhandled internal error', context);
  }
}
