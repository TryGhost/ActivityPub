import type { MockedFunction } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AwilixContainer } from 'awilix';
import type { Hono, MiddlewareHandler } from 'hono';

import type { AppContext, HonoContextVariables } from '@/app';
import { ROUTES_METADATA_KEY } from '../decorators/route.decorator';
import { GhostRole } from '../middleware/role-guard';
import { RouteRegistry } from './route-registry';

// Mock types for Hono app methods
type MockedHono = {
    get: MockedFunction<(...args: unknown[]) => unknown>;
    post: MockedFunction<(...args: unknown[]) => unknown>;
    put: MockedFunction<(...args: unknown[]) => unknown>;
    delete: MockedFunction<(...args: unknown[]) => unknown>;
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
            get: vi.fn(),
            post: vi.fn(),
            put: vi.fn(),
            delete: vi.fn(),
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
            expect(mockApp.get).toHaveBeenCalledWith(
                '/test',
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
            expect(mockApp.get).toHaveBeenCalled();
            const call = mockApp.get.mock.calls[0];
            expect(call[0]).toBe('/:version/test');
            // Should have multiple middlewares when versions are specified
            expect(call.length).toBeGreaterThan(2);
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

            expect(mockApp.get).toHaveBeenCalledWith(
                '/test1',
                expect.any(Function),
            );
            expect(mockApp.post).toHaveBeenCalled();
            const postCall = mockApp.post.mock.calls[0];
            expect(postCall[0]).toBe('/:version/test2');
            // Should have at least 2 middlewares when versions are specified (version + controller)
            expect(postCall.length).toBeGreaterThanOrEqual(2);
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
            const callArgs = mockApp.get.mock.calls[0];
            // Skip the path argument, the rest are middlewares
            const middlewares = callArgs.slice(1);
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

            const callArgs = mockApp.get.mock.calls[0];
            const middlewares = callArgs.slice(1);
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

            const callArgs = mockApp.post.mock.calls[0];
            const middlewares = callArgs.slice(1);
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

            // Should only have one middleware (the controller handler)
            const middlewares = mockApp.get.mock.calls[0];
            expect(middlewares.length).toBe(2); // path + handler
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

            // Should only have one middleware (the controller handler)
            const middlewares = mockApp.get.mock.calls[0];
            expect(middlewares.length).toBe(2); // path + handler
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

            const middlewares = mockApp.get.mock.calls[0].slice(1);

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
