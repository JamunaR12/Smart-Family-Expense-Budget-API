import { VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import {
  API_DOCS_PATH,
  API_TITLE,
  DEFAULT_API_VERSION,
  GLOBAL_API_PREFIX,
  configureApp,
} from '../../src/config/configure-app';

/**
 * Unit tests for `configureApp()` global wiring (Task 1.6, Req 16.5).
 *
 * `configureApp()` is the single source of truth applied by BOTH bootstrap
 * paths (local `listen()` and the Lambda proxy), so verifying it in isolation
 * proves the two environments share identical routing/versioning/docs wiring.
 *
 * The test uses a lightweight app double (spies) rather than a full Nest app so
 * it stays fast and deterministic and never opens a port or touches a DB.
 */
describe('configureApp() global wiring (Req 16.5)', () => {
  /**
   * Builds a minimal INestApplication double exposing only the methods
   * `configureApp` calls, each replaced with a jest spy.
   */
  function createAppDouble() {
    const app = {
      setGlobalPrefix: jest.fn(),
      enableVersioning: jest.fn(),
      useGlobalPipes: jest.fn(),
      useGlobalFilters: jest.fn(),
      useGlobalInterceptors: jest.fn(),
      useGlobalGuards: jest.fn(),
      enableCors: jest.fn(),
    };
    return app as unknown as INestApplication & typeof app;
  }

  let createDocumentSpy: jest.SpyInstance;
  let setupSpy: jest.SpyInstance;

  beforeEach(() => {
    // Swagger document generation requires a real Nest container to scan; stub
    // it out so the wiring assertions stay isolated and deterministic.
    createDocumentSpy = jest
      .spyOn(SwaggerModule, 'createDocument')
      .mockReturnValue({} as ReturnType<typeof SwaggerModule.createDocument>);
    setupSpy = jest
      .spyOn(SwaggerModule, 'setup')
      .mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sets the global prefix to "api"', () => {
    const app = createAppDouble();

    configureApp(app);

    expect(app.setGlobalPrefix).toHaveBeenCalledWith(GLOBAL_API_PREFIX);
    expect(GLOBAL_API_PREFIX).toBe('api');
  });

  it('enables URI versioning with default version "1" (=> /api/v1)', () => {
    const app = createAppDouble();

    configureApp(app);

    expect(app.enableVersioning).toHaveBeenCalledWith({
      type: VersioningType.URI,
      defaultVersion: DEFAULT_API_VERSION,
    });
    expect(DEFAULT_API_VERSION).toBe('1');
  });

  it('mounts the OpenAPI/Swagger docs at /api/v1/docs (Req 18.1)', () => {
    const app = createAppDouble();

    configureApp(app);

    expect(createDocumentSpy).toHaveBeenCalledTimes(1);
    expect(setupSpy).toHaveBeenCalledTimes(1);

    // First arg to SwaggerModule.setup is the docs path.
    expect(setupSpy.mock.calls[0][0]).toBe(API_DOCS_PATH);
    expect(API_DOCS_PATH).toBe('api/v1/docs');
    expect(API_TITLE).toBe('Smart Expense Insights Platform API');
  });

  it('returns the same application instance for fluent usage', () => {
    const app = createAppDouble();

    expect(configureApp(app)).toBe(app);
  });
});
