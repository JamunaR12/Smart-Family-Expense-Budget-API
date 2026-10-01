import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import {
  CORRELATION_ID_HEADER,
  correlationStorage,
} from '../logging/correlation-context';

/**
 * Correlation-id middleware (Req 14.6).
 *
 * For every request: reads an inbound `x-correlation-id` header, or generates a
 * UUID when absent. The id is:
 *  - attached to the request object (`req.correlationId`) for direct access,
 *  - stored in an `AsyncLocalStorage` context so all logs for the request share
 *    the same id without explicit threading,
 *  - echoed back on the response `x-correlation-id` header so clients can
 *    correlate their calls.
 *
 * The remainder of the request lifecycle runs inside `correlationStorage.run`
 * so downstream handlers observe the correct id.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.headers[CORRELATION_ID_HEADER];
    const correlationId = this.normalize(inbound) ?? randomUUID();

    (req as Request & { correlationId: string }).correlationId = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    correlationStorage.run({ correlationId }, () => {
      next();
    });
  }

  /** Extracts a non-empty single header value, ignoring blank/array values. */
  private normalize(value: string | string[] | undefined): string | undefined {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === 'string' && raw.trim() !== '') {
      return raw.trim();
    }
    return undefined;
  }
}
