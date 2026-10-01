import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import serverlessExpress from '@codegenie/serverless-express';
import { AppModule } from './app.module';
import { configureApp } from './config/configure-app';

/**
 * Single-codebase, dual-target bootstrap (design §AWS Lambda + API Gateway
 * Architecture → "Single-codebase bootstrap"; §Local-to-AWS Deployment
 * Approach).
 *
 * The SAME `AppModule` and the SAME `configureApp()` global wiring drive both
 * runtime targets. The only thing that differs is HOW the app is started:
 *
 *   - local  (RUNTIME_ENV=local): a real Express HTTP server via `app.listen()`
 *   - aws    (RUNTIME_ENV=aws):   an exported Lambda `handler` that proxies API
 *                                 Gateway events into the same Express instance
 *                                 through `@codegenie/serverless-express`.
 *
 * This guarantees equivalent routing/validation/error behavior across
 * environments (Req 16.3, 16.5; C4, C5). No divergent business source exists.
 */

/**
 * A minimal structural type for the Lambda entry point. The upstream
 * `@codegenie/serverless-express` types reference `aws-lambda`'s `Handler`,
 * which we do not depend on directly; this local alias keeps the signature
 * accurate without pulling in extra `@types`.
 */
type LambdaHandler = (
  event: unknown,
  context: unknown,
  callback?: unknown,
) => unknown;

/**
 * Builds and configures a Nest application WITHOUT starting a listener.
 *
 * Used by the Lambda path (which calls `app.init()` instead of `listen()`) and
 * as the shared construction step for the local path. Keeping construction and
 * global wiring in one place is what makes the two entry points non-divergent.
 */
async function createConfiguredApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app as INestApplication);
  return app;
}

/**
 * Module-scoped cache for the serverless proxy.
 *
 * On AWS Lambda, module scope persists across WARM invocations within the same
 * execution environment. Caching the initialized proxy here means the expensive
 * work — `NestFactory.create()`, DI graph construction, and (later) the Prisma
 * connection — happens ONCE per container cold start and is reused thereafter.
 */
let cachedServer: LambdaHandler | undefined;

/**
 * Lazily bootstraps the Nest app for Lambda and wraps its Express instance with
 * `serverless-express`. Note `app.init()` (NOT `listen()`): Lambda does not own
 * a socket — API Gateway invokes the handler and the proxy translates events
 * into Express requests.
 */
async function bootstrapServer(): Promise<LambdaHandler> {
  const app = await createConfiguredApp();
  await app.init(); // initialize DI/lifecycle without binding a port
  const expressApp = app.getHttpAdapter().getInstance();
  return serverlessExpress({ app: expressApp }) as unknown as LambdaHandler;
}

/**
 * AWS Lambda entry point (referenced by `template.yaml` as `dist/main.handler`).
 *
 * The proxy is bootstrapped on the first invocation and reused on every warm
 * invocation via the module-scoped `cachedServer` (cold-start mitigation, design
 * §Cold start handling). Always exported so importing this module under Lambda
 * never starts a listening server.
 */
export const handler: LambdaHandler = async (event, context, callback) => {
  cachedServer ??= await bootstrapServer();
  return cachedServer(event, context, callback);
};

/**
 * Local entry point: create + configure the app, then bind an HTTP port.
 *
 * Port-binding failures (e.g. the port is already in use) must abort startup
 * with a clear, descriptive message rather than a raw stack trace (Req 16.2).
 */
async function bootstrapLocal(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const app = await createConfiguredApp();

  // Surface a precise error if the port cannot be bound. Node emits an
  // `EADDRINUSE` error asynchronously on the underlying server, so we both
  // await `listen()` and register a listener error handler to catch it.
  try {
    await app.listen(port);
    console.log(
      `Smart Expense Insights Platform listening on http://localhost:${port} (RUNTIME_ENV=local)`,
    );
  } catch (error) {
    handleListenError(error, port);
  }
}

/**
 * Translates a listen/port error into a clear, actionable message and aborts
 * startup with a non-zero exit code (Req 16.2). `EADDRINUSE` is called out
 * explicitly because it is the common, recoverable operator error.
 */
function handleListenError(error: unknown, port: number): never {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EADDRINUSE') {
    console.error(
      `Failed to start: port ${port} is already in use. ` +
        `Stop the process using it or set a different PORT, then retry.`,
    );
  } else {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to start local server on port ${port}: ${message}`);
  }
  process.exit(1);
}

/**
 * Start the local server ONLY when not running on AWS. Under Lambda
 * (`RUNTIME_ENV=aws`) the runtime imports this module to obtain `handler`, and
 * we must NOT open a socket. Any other value (including `local` or unset in dev)
 * starts the HTTP server.
 */
if (process.env.RUNTIME_ENV !== 'aws') {
  void bootstrapLocal();
}
