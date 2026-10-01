import {
  BadRequestException,
  INestApplication,
  ValidationError,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import type { ErrorDetail } from '../common/filters/all-exceptions.filter';
import { ERROR_CODES } from '../common/filters/error-codes';
import { LoggingInterceptor } from '../common/interceptors/logging.interceptor';
import { CORRELATION_ID_HEADER } from '../common/logging/correlation-context';

/**
 * Flattens class-validator `ValidationError[]` (including nested children) into
 * one `{ field, reason }` per failing constraint, so the error envelope names
 * every failing, unrecognized, or missing/null field (Req 12.2, 12.3, 12.4,
 * 13.4; feeds Property 26). Nested object properties are reported with a
 * dotted path (e.g. `address.city`).
 */
function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): ErrorDetail[] {
  const details: ErrorDetail[] = [];

  for (const error of errors) {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;

    if (error.constraints) {
      // One detail per failing constraint (`forbidNonWhitelisted` names the
      // unknown field; `@IsNotEmpty`/type validators name missing/null fields).
      for (const reason of Object.values(error.constraints)) {
        details.push({ field, reason });
      }
    }

    if (error.children && error.children.length > 0) {
      details.push(...flattenValidationErrors(error.children, field));
    }
  }

  return details;
}

/**
 * `exceptionFactory` for the global `ValidationPipe`: converts class-validator
 * failures into a `BadRequestException` carrying the in-envelope shape
 * `{ code: 'VALIDATION_ERROR', message, details[] }` so the failure ALREADY
 * arrives in the consistent envelope and the `AllExceptionsFilter` passes it
 * through unchanged (Req 12.2-12.4, 13.4).
 */
function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  const details = flattenValidationErrors(errors);
  return new BadRequestException({
    code: ERROR_CODES.VALIDATION_ERROR,
    message: 'Validation failed',
    details,
  });
}

/**
 * Global API prefix applied to every route (design §API Design and Versioning).
 * Combined with URI versioning this yields the `/api/v1/...` surface.
 */
export const GLOBAL_API_PREFIX = 'api';

/** Default API version served under the prefix (`/api/v1`). */
export const DEFAULT_API_VERSION = '1';

/**
 * Path (relative to the server root) at which the interactive OpenAPI/Swagger
 * documentation UI and JSON are served (Req 18.1). Mounted under the same
 * `/api/v1` surface as the rest of the API.
 */
export const API_DOCS_PATH = 'api/v1/docs';

/** Human-facing title of the generated OpenAPI document (Req 18.1). */
export const API_TITLE = 'Smart Expense Insights Platform API';

/** OpenAPI document version tag. */
export const API_VERSION = 'v1';

/**
 * Name of the optional environment variable holding a comma-separated list of
 * allowed cross-origin origins (task 8.2). It is intentionally read from
 * `process.env` here (already validated at startup by the config module) rather
 * than via `app.get(AppConfigService)`, so `configureApp()` stays decoupled
 * from a fully-initialized DI container and the lightweight unit-test app double
 * keeps working.
 */
export const CORS_ORIGINS_ENV = 'CORS_ORIGINS';

/**
 * Parses `CORS_ORIGINS` into the `origin` option accepted by `enableCors()`.
 *
 * SAFE DEFAULT (documented): when `CORS_ORIGINS` is unset/blank, returns
 * `false`, which disables cross-origin access entirely — the browser will not
 * see permissive CORS headers. We NEVER default to `'*'`, and never combine
 * `'*'` with credentials. When the variable is set, only the exact listed
 * origins (comma-separated, trimmed, blanks dropped) are allowed. If the value
 * is present but yields no usable origins, we also fall back to `false`.
 */
export function parseCorsOrigins(raw: string | undefined): string[] | false {
  if (typeof raw !== 'string') {
    return false;
  }
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return origins.length > 0 ? origins : false;
}

/**
 * Mounts the OpenAPI/Swagger documentation.
 *
 * Kept in `configureApp()` so the docs surface is identical in BOTH runtime
 * targets (local `app.listen()` and the Lambda `serverless-express` proxy):
 * `SwaggerModule.setup` registers routes on the underlying Express instance,
 * which the Lambda proxy also serves (Req 16.5, 18.1).
 *
 * As feature modules add controllers in later phases, their `@ApiTags`/
 * `@ApiOperation`/`@ApiResponse` decorators are picked up automatically by the
 * document scanner — no change needed here.
 */
function setupApiDocs(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle(API_TITLE)
    .setDescription(
      'Secure, per-user expense management API: expenses, categories, ' +
        'budgets, and spending analytics.',
    )
    .setVersion(API_VERSION)
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(API_DOCS_PATH, app, document);
}

/**
 * Single source of truth for global application wiring.
 *
 * This function is deliberately environment-agnostic: it is invoked by BOTH
 * bootstrap paths in `main.ts` — the local `app.listen()` server and the AWS
 * Lambda `handler` — so the two environments expose identical HTTP behavior
 * (routing, versioning, and later validation/error/logging semantics). This is
 * the mechanism that satisfies the "single, non-divergent codebase" constraint
 * (Req 16.5, C5): there is no branch in business or middleware wiring between
 * local and Lambda — the ONLY difference lives in how the app is started
 * (`listen()` vs `serverless-express` proxy).
 *
 * Phase 1 responsibilities (implemented now):
 * - URI versioning + global prefix, producing the design's `/api/v1` surface
 *   (design §API Design and Versioning; supports Req 18.3/18.4).
 *
 * Later tasks slot their global providers in here (see the clearly-marked
 * extension points below) so they, too, apply uniformly across environments.
 * They are intentionally NOT implemented in this task.
 *
 * @param app the created (but not yet started) Nest application instance
 * @returns the same instance, configured, to allow fluent usage
 */
export function configureApp(app: INestApplication): INestApplication {
  // Global route prefix: every controller route is served under `/api`.
  app.setGlobalPrefix(GLOBAL_API_PREFIX);

  // URI-based versioning: routes are addressed as `/api/v1/<resource>`
  // (design §API Design and Versioning). New versions can be added without
  // breaking existing clients (Req 18.3, 18.4).
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: DEFAULT_API_VERSION,
  });

  // OpenAPI/Swagger docs at `/api/v1/docs` (Req 18.1). Mounted here so both the
  // local server and the Lambda proxy expose identical documentation.
  setupApiDocs(app);

  // Global request validation (Req 12.1–12.4).
  //
  // NOTE: task 7.1 (Phase 7) OWNS the final wiring and the property tests for
  // this pipe. It is registered NOW because the Phase 3 auth DTOs must actually
  // be validated for Req 1.3/1.4 (registration) and Req 2.3 (login) to hold —
  // without the pipe those DTO rules would not run. This is the design's single
  // global pipe (design §Error Handling), not a new architecture decision.
  //
  // The `exceptionFactory` (task 7.1) maps class-validator failures into the
  // in-envelope `{ code:'VALIDATION_ERROR', message, details[] }` shape so each
  // failing/unrecognized/missing field is named (Req 12.2-12.4) and the
  // AllExceptionsFilter passes the failure through unchanged.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  // Global error envelope (Req 13.1-13.4). The single edge that converts every
  // thrown error into the consistent `{ success, error, meta }` envelope with a
  // machine-readable code, a <=500-char message, and 4xx/5xx status classes,
  // stripping internals from unexpected 500s (Req 13.2). Registered here (not
  // per-environment) so local and Lambda return identical error responses
  // (Req 16.5). MUST be registered so it wraps validation-pipe/guard errors.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global authentication guard (Req 3.4, 3.5), opt-out via @Public().
  //
  // Every route requires a valid Authentication_Token by default; the
  // `@Public()`-marked auth endpoints and docs are allowed through. Registered
  // here (not per-environment) so local and Lambda authenticate identically
  // (Req 16.5). The passport `jwt` strategy is provided by `AuthModule`.
  //
  // `Reflector` is instantiated directly rather than resolved via `app.get()`:
  // it is a stateless metadata reader with a no-arg constructor, so this keeps
  // `configureApp()` decoupled from a fully-initialized DI container (the
  // guard only needs the reflector to read `@Public()` route metadata).
  app.useGlobalGuards(new JwtAuthGuard(new Reflector()));

  // Global structured request logging (task 8.1, Req 14.1–14.3, 14.6).
  //
  // Emits exactly one structured entry per request (method, route, status,
  // correlationId, ms-precision timestamp, severity, durationMs; error category
  // on failure). Registered here (not per-environment) so local and Lambda log
  // identically (Req 16.5).
  //
  // DESIGN DEVIATION (intentional): the design mentions a companion
  // `ResponseEnvelopeInterceptor`. It is deliberately NOT added — current
  // success responses are already shaped by the controllers/services and the
  // existing controller/e2e tests assert those shapes, so adding a
  // success-envelope wrapper now would break them. Only the LoggingInterceptor
  // is wired.
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Environment-driven CORS (task 8.2, security checklist; applies to BOTH
  // local and Lambda per Req 16.5). Origins come from the validated
  // `CORS_ORIGINS` env var (comma-separated). SAFE DEFAULT: when unset, CORS is
  // disabled (`origin: false`) — we never default to `'*'`, and never pair
  // `'*'` with credentials. `Authorization` and the correlation header are
  // explicitly allowed so authenticated cross-origin clients work when enabled.
  app.enableCors({
    origin: parseCorsOrigins(process.env[CORS_ORIGINS_ENV]),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', CORRELATION_ID_HEADER],
    exposedHeaders: [CORRELATION_ID_HEADER],
  });

  return app;
}
