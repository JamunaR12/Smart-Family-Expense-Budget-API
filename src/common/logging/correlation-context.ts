import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped correlation context.
 *
 * Uses Node's `AsyncLocalStorage` so any code running within a request (logger,
 * interceptors, services) can retrieve the correlation id without threading it
 * through every function signature. Populated by `CorrelationIdMiddleware`
 * (Req 14.6).
 */
export interface CorrelationStore {
  correlationId: string;
}

export const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

/** Header carrying an inbound correlation id, if the client supplies one. */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/** Returns the correlation id for the current request, or undefined if unset. */
export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore()?.correlationId;
}
