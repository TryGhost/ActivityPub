import type { MockedFunction } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AwilixContainer } from 'awilix';
import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import type { AppContext, HonoContextVariables } from '@/app';
import { ROUTES_METADATA_KEY } from '../decorators/route.decorator';
import { GhostRole } from '../middleware/role-guard';
import { RouteRegistry } from './route-registry';

// Mock types for Hono app methods
type MockedHono = {
    on: MockedFunction<(...args: unknown[]) => unknown>;
};

// Mock type for Awilix container
type MockedContainer = {
    resolve: MockedFunction<(token: string) => unknown>;
};

describe('RouteRegistry', () => {
    let routeRegistry: RouteRegistry;
    let mockApp: MockedHono;
    let mockContainer: MockedContainer;

    beforeEach(() => {
        routeRegistry = new RouteRegistry();
        mockApp = {
            on: vi.fn(),
        };
        mockContainer = {
            resolve: vi.fn(),
        };
    });

    describe('registerRoute', () => {
        it('should register a route', () => {
            const registration = {
                method: 'GET' as const,
                path: '/test',
                controllerToken: 'TestController',
                methodName: 'testMethod',
            };

            routeRegistry.registerRoute(registration);

            // Routes are private, so we'll test via mountRoutes
            routeRegistry.mountRoutes(
                mockApp as unknown as Hono<{ Variables: HonoContextVariables }>,
                mockContainer as unknown as AwilixContainer,
            );
            expect(mockApp.on).toHaveBeenCalledWith(
                'GET',
                ['/test'],
                expect.any(Function),
            );
        });

        it('should register a route with versions', () => {
            const registration = {
                method: 'GET' as const,
                path: '/:version/test',
                controllerToken: 'TestController',
                methodName: 'testMethod',
                versions: ['v1', 'v2'],
            };

            routeRegistry.registerRoute(registration);

            routeRegistry.mountRoutes(
                mockApp as unknown as Hono<{ Variables: HonoContextVariables }>,
                mockContainer as unknown as AwilixContainer,
            );
            expect(mockApp.on).toHaveBeenCalled();
            const call = mockApp.on.mock.calls[0];
            expect(call[0]).toBe('GET');
            expect(call[1]).toEqual(['/:version/test']);
            // Should have multiple middlewares when versions are specified
            // Args: method, [path], ...middlewares — so >3 means at least 2 middlewares
            expect(call.length).toBeGreaterThan(3);
        });

        it('should mount static routes before dynamic routes with the same prefix', () => {
            routeRegistry.registerRoute({
                method: 'GET' as const,
                path: '/.ghost/activitypub/:version/account/:handle',
                controllerToken: 'TestController',
                methodName: 'handleGetAccount',
                versions: ['v1'],
            });
            routeRegistry.registerRoute({
                method: 'GET' as const,
                path: '/.ghost/activitypub/:version/account/aliases',
                controllerToken: 'TestController',
                methodName: 'handleGetAccountAliases',
                versions: ['v1'],
            });

            routeRegistry.mountRoutes(
                mockApp as unknown as Hono<{ Variables: HonoContextVariables }>,
                mockContainer as unknown as AwilixContainer,
            );

            expect(mockApp.on.mock.calls[0][0]).toBe('GET');
            expect(mockApp.on.mock.calls[0][1]).toEqual([
                '/.ghost/activitypub/:version/account/aliases',
            ]);
            expect(mockApp.on.mock.calls[1][0]).toBe('GET');
            expect(mockApp.on.mock.calls[1][1]).toEqual([
                '/.ghost/activitypub/:version/account/:handle',
            ]);
        });

        it('should route static GET routes before dynamic GET routes when other methods are interleaved', async () => {
            const app = new Hono<{ Variables: HonoContextVariables }>();
            const controller = {
                handleGetAccount: vi.fn(
                    (ctx: AppContext) =>
                        new Response(`dynamic:${ctx.req.param('handle')}`),
                ),
                handleAddAccountAlias: vi.fn(() => new Response('add-alias')),
                handleGetAccountAliases: vi.fn(() => new Response('aliases')),
            };

            mockContainer.resolve.mockReturnValue(controller);
            routeRegistry.registerRoute({
                method: 'GET' as const,
                path: '/account/:handle',
                controllerToken: 'TestController',
                methodName: 'handleGetAccount',
            });
            routeRegistry.registerRoute({
                method: 'POST' as const,
                path: '/account/aliases',
                controllerToken: 'TestController',
                methodName: 'handleAddAccountAlias',
            });
            routeRegistry.registerRoute({
                method: 'GET' as const,
                path: '/account/aliases',
                controllerToken: 'TestController',
                methodName: 'handleGetAccountAliases',
            });

            routeRegistry.mountRoutes(
                app,
                mockContainer as unknown as AwilixContainer,
            );

            const response = await app.request('/account/aliases');

            expect(await response.text()).toBe('aliases');
            expect(controller.handleGetAccountAliases).toHaveBeenCalled();
            expect(controller.handleGetAccount).not.toHaveBeenCalled();
        });
    });

    describe('registerController', () => {
        it('should register all routes from controller metadata', () => {
            const TestController = class {};
            const routes = [
                {
                    method: 'GET',
                    path: '/test1',
                    methodName: 'method1',
                },
                {
                    method: 'POST',
                    path: '/:version/test2',
                    methodName: 'method2',
                    versions: ['v1', 'v2'],
                },
            ];

            Reflect.defineMetadata(
                ROUTES_METADATA_KEY,
                routes,
                TestController.prototype,
            );

            routeRegistry.registerController('TestController', TestController);
            routeRegistry.mountRoutes(
                mockApp as unknown as Hono<{ Variables: HonoContextVariables }>,
                mockContainer as unknown as AwilixContainer,
            );

            expect(mockApp.on).toHaveBeenCalledWith(
                'GET',
                ['/test1'],
                expect.any(Function),
            );
            const postCall = mockApp.on.mock.calls.find((c) => c[0] === 'POST');
            expect(postCall).toBeDefined();
            expect(postCall![1]).toEqual(['/:version/test2']);
            // Args: method, [path], ...middlewares — at least 2 middlewares (version + controller)
            expect(postCall!.length).toBeGreaterThanOrEqual(4);
        });
    });

    describe('version middleware', () => {
        let mockContext: Partial<AppContext>;
        let mockNext: MockedFunction<() => Promise<void>>;
        let mockController: {
            testMethod: MockedFunction<() => Promise<{ status: number }>>;
        };

        beforeEach(() => {
            mockNext = vi.fn().mockResolvedValue(undefined);
            mockController = {
                testMethod: vi.fn().mockResolvedValue({ status: 200 }),
            };
            mockContainer.resolve = vi.fn().mockReturnValue(mockController);

            mockContext = {
                req: {
                    param: vi.fn() as MockedFunction<(key: string) => string>,
                } as unknown as AppContext['req'],
                json: vi.fn().mockReturnValue({ status: 404 }),
                get: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn() }),
            };
        });

        it('should allow request when version matches', async () => {
            const registration = {
                method: 'GET' as const,
                path: '/:version/test',
                controllerToken: 'TestController',
                methodName: 'testMethod',
                versions: ['v1', 'v2'],
            };

            routeRegistry.registerRoute(registration);
            routeRegistry.mountRoutes(
                mockApp as unknown as Hono<{ Variables: HonoContextVariables }>,
                mockContainer as unknown as AwilixContainer,
            );

            // Get the middleware array from the first call
            // Args: method, [path], ...middlewares — skip first 2
            const callArgs = mockApp.on.mock.calls[0];
            const middlewares = callArgs.slice(2);
            const versionMiddleware = middlewares[0] as MiddlewareHandler;

            (mockContext.req!.param as unknown as MockedFunction<
                (key: string) => string
            >) = vi.fn().mockReturnValue('v1');

            await versionMiddleware(mockContext as AppContext, mockNext);

            expect(mockNext).toHaveBeenCalled();
            expect(mockContext.json).not.toHaveBeenCalled();
        });

        it('should return 410 with INVALID_VERSION when version does not match', async () => {
            const registration = {
                method: 'GET' as const,
                path: '/:version/test',
                controllerToken: 'TestController',
                methodName: 'testMethod',
                versions: ['v1', 'v2'],
            };

            routeRegistry.registerRoute(registration);
            routeRegistry.mountRoutes(
                mockApp as unknown as Hono<{ Variables: HonoContextVariables }>,
                mockContainer as unknown as AwilixContainer,
            );

            const callArgs = mockApp.on.mock.calls[0];
            const middlewares = callArgs.slice(2);
            const versionMiddleware = middlewares[0] as MiddlewareHandler;

            (mockContext.req!.param as unknown as MockedFunction<
                (key: string) => string
            >) = vi.fn().mockReturnValue('v3');

            const result = await versionMiddleware(
                mockContext as AppContext,
                mockNext,
            );

            expect(mockNext).not.toHaveBeenCalled();
            expect(mockContext.json).toHaveBeenCalledWith(
                {
                    message: 'Version v3 is not supported.',
                    code: 'INVALID_VERSION',
                    requestedVersion: 'v3',
                    supportedVersions: ['v1', 'v2'],
                },
                410,
            );
            expect(result).toBe(
                (
                    mockContext.json as MockedFunction<
                        (...args: unknown[]) => unknown
                    >
                ).mock.results[0].value,
            );
        });

        it('should include supported versions in error response', async () => {
            const registration = {
                method: 'POST' as const,
                path: '/:version/resource',
                controllerToken: 'TestController',
                methodName: 'testMethod',
                versions: ['v1', 'v2', 'v3'],
            };

            routeRegistry.registerRoute(registration);
            routeRegistry.mountRoutes(
                mockApp as unknown as Hono<{ Variables: HonoContextVariables }>,
                mockContainer as unknown as AwilixContainer,
            );

            const callArgs = mockApp.on.mock.calls[0];
            const middlewares = callArgs.slice(2);
            const versionMiddleware = middlewares[0] as MiddlewareHandler;

            (mockContext.req!.param as unknown as MockedFunction<
                (key: string) => string
            >) = vi.fn().mockReturnValue('v4');

            await versionMiddleware(mockContext as AppContext, mockNext);

            expect(mockContext.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    supportedVersions: ['v1', 'v2', 'v3'],
                }),
                410,
            );
        });

        it('should not add version middleware when versions array is empty', () => {
            const registration = {
                method: 'GET' as const,
                path: '/test',
                controllerToken: 'TestController',
                methodName: 'testMethod',
                versions: [],
            };

            routeRegistry.registerRoute(registration);
            routeRegistry.mountRoutes(
                mockApp as unknown as Hono<{ Variables: HonoContextVariables }>,
                mockContainer as unknown as AwilixContainer,
            );

            // Args: method, [path], ...middlewares — only the controller handler expected
            const callArgs = mockApp.on.mock.calls[0];
            expect(callArgs.length).toBe(3); // method + [path] + handler
        });

        it('should not add version middleware when versions is undefined', () => {
            const registration = {
                method: 'GET' as const,
                path: '/test',
                controllerToken: 'TestController',
                methodName: 'testMethod',
            };

            routeRegistry.registerRoute(registration);
            routeRegistry.mountRoutes(
                mockApp as unknown as Hono<{ Variables: HonoContextVariables }>,
                mockContainer as unknown as AwilixContainer,
            );

            // Args: method, [path], ...middlewares — only the controller handler expected
            const callArgs = mockApp.on.mock.calls[0];
            expect(callArgs.length).toBe(3); // method + [path] + handler
        });
    });

    describe('middleware ordering', () => {
        it('should apply middlewares in correct order: version -> roles -> controller', async () => {
            const registration = {
                method: 'GET' as const,
                path: '/:version/protected',
                controllerToken: 'TestController',
                methodName: 'testMethod',
                versions: ['v1'],
                requiredRoles: [GhostRole.Administrator],
            };

            const mockController = {
                testMethod: vi.fn().mockResolvedValue({ status: 200 }),
            };
            mockContainer.resolve = vi.fn().mockReturnValue(mockController);

            routeRegistry.registerRoute(registration);
            routeRegistry.mountRoutes(
                mockApp as unknown as Hono<{ Variables: HonoContextVariables }>,
                mockContainer as unknown as AwilixContainer,
            );

            // Args: method, [path], ...middlewares — skip first 2
            const middlewares = mockApp.on.mock.calls[0].slice(2);

            // Should have 3 middlewares: version, role, controller
            expect(middlewares.length).toBe(3);

            // Test that version middleware is first by checking if it handles version param
            const mockTestContext = {
                req: {
                    param: vi.fn().mockReturnValue('v1') as MockedFunction<
                        (key: string) => string
                    >,
                },
                json: vi.fn(),
                get: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn() }),
            } as unknown as AppContext;
            const mockTestNext = vi.fn();

            // First middleware should be version check
            const firstMiddleware = middlewares[0] as MiddlewareHandler;
            await firstMiddleware(mockTestContext, mockTestNext);
            expect(
                mockTestContext.req.param as unknown as MockedFunction<
                    (key: string) => string
                >,
            ).toHaveBeenCalledWith('version');
        });
    });
});
