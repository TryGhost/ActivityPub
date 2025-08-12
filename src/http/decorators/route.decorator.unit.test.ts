import { beforeEach, describe, expect, it } from 'vitest';
import 'reflect-metadata';

import { GhostRole } from '@/http/middleware/role-guard';
import {
    APIRoute,
    DEFAULT_API_VERSION,
    RequireRoles,
    ROLES_METADATA_KEY,
    ROUTES_METADATA_KEY,
    Route,
} from './route.decorator';

// Define a test controller class type
class TestController {
    testMethod() {}
    anotherMethod() {}
}

describe('Route Decorators', () => {
    let TestClass: typeof TestController;

    beforeEach(() => {
        TestClass = class {
            testMethod() {}
            anotherMethod() {}
        };
    });

    describe('Route', () => {
        it('should add route metadata to the target', () => {
            Route('GET', '/test')(TestClass.prototype, 'testMethod');

            const routes = Reflect.getMetadata(
                ROUTES_METADATA_KEY,
                TestClass.prototype,
            );

            expect(routes).toHaveLength(1);
            expect(routes[0]).toEqual({
                method: 'GET',
                path: '/test',
                methodName: 'testMethod',
            });
        });

        it('should append multiple routes to the same target', () => {
            Route('GET', '/test1')(TestClass.prototype, 'testMethod');
            Route('POST', '/test2')(TestClass.prototype, 'anotherMethod');

            const routes = Reflect.getMetadata(
                ROUTES_METADATA_KEY,
                TestClass.prototype,
            );

            expect(routes).toHaveLength(2);
            expect(routes[0]).toEqual({
                method: 'GET',
                path: '/test1',
                methodName: 'testMethod',
            });
            expect(routes[1]).toEqual({
                method: 'POST',
                path: '/test2',
                methodName: 'anotherMethod',
            });
        });
    });

    describe('APIRoute', () => {
        it('should add versioned API route with default version', () => {
            APIRoute('GET', '/users')(TestClass.prototype, 'testMethod');

            const routes = Reflect.getMetadata(
                ROUTES_METADATA_KEY,
                TestClass.prototype,
            );

            expect(routes).toHaveLength(1);
            expect(routes[0]).toEqual({
                method: 'GET',
                path: '/.ghost/activitypub/:version/users',
                methodName: 'testMethod',
                versions: [DEFAULT_API_VERSION],
            });
        });

        it('should add versioned API route with specified versions', () => {
            APIRoute(
                'POST',
                '/posts',
                'v1',
                'v2',
            )(TestClass.prototype, 'testMethod');

            const routes = Reflect.getMetadata(
                ROUTES_METADATA_KEY,
                TestClass.prototype,
            );

            expect(routes).toHaveLength(1);
            expect(routes[0]).toEqual({
                method: 'POST',
                path: '/.ghost/activitypub/:version/posts',
                methodName: 'testMethod',
                versions: ['v1', 'v2'],
            });
        });

        it('should strip leading slash from path', () => {
            APIRoute('GET', '/users', 'v1')(TestClass.prototype, 'testMethod');

            const routes = Reflect.getMetadata(
                ROUTES_METADATA_KEY,
                TestClass.prototype,
            );

            expect(routes[0].path).toBe('/.ghost/activitypub/:version/users');
        });

        it('should work without leading slash', () => {
            APIRoute('GET', 'users', 'v1')(TestClass.prototype, 'testMethod');

            const routes = Reflect.getMetadata(
                ROUTES_METADATA_KEY,
                TestClass.prototype,
            );

            expect(routes[0].path).toBe('/.ghost/activitypub/:version/users');
        });

        it('should support multiple versions', () => {
            APIRoute(
                'GET',
                '/resource',
                'v1',
                'v2',
                'v3',
            )(TestClass.prototype, 'testMethod');

            const routes = Reflect.getMetadata(
                ROUTES_METADATA_KEY,
                TestClass.prototype,
            );

            expect(routes[0].versions).toEqual(['v1', 'v2', 'v3']);
        });

        it('should use default version when no versions specified', () => {
            APIRoute('GET', '/resource')(TestClass.prototype, 'testMethod');

            const routes = Reflect.getMetadata(
                ROUTES_METADATA_KEY,
                TestClass.prototype,
            );

            expect(routes[0].versions).toEqual([DEFAULT_API_VERSION]);
        });
    });

    describe('RequireRoles', () => {
        it('should add roles metadata to the target method', () => {
            RequireRoles(GhostRole.Administrator, GhostRole.Editor)(
                TestClass.prototype,
                'testMethod',
            );

            const roles = Reflect.getMetadata(
                ROLES_METADATA_KEY,
                TestClass.prototype,
                'testMethod',
            );

            expect(roles).toEqual([GhostRole.Administrator, GhostRole.Editor]);
        });

        it('should allow single role', () => {
            RequireRoles(GhostRole.Administrator)(
                TestClass.prototype,
                'testMethod',
            );

            const roles = Reflect.getMetadata(
                ROLES_METADATA_KEY,
                TestClass.prototype,
                'testMethod',
            );

            expect(roles).toEqual([GhostRole.Administrator]);
        });

        it('should allow multiple roles on different methods', () => {
            RequireRoles(GhostRole.Administrator)(
                TestClass.prototype,
                'testMethod',
            );
            RequireRoles(GhostRole.Editor, GhostRole.Author)(
                TestClass.prototype,
                'anotherMethod',
            );

            const roles1 = Reflect.getMetadata(
                ROLES_METADATA_KEY,
                TestClass.prototype,
                'testMethod',
            );
            const roles2 = Reflect.getMetadata(
                ROLES_METADATA_KEY,
                TestClass.prototype,
                'anotherMethod',
            );

            expect(roles1).toEqual([GhostRole.Administrator]);
            expect(roles2).toEqual([GhostRole.Editor, GhostRole.Author]);
        });
    });

    describe('Combined decorators', () => {
        it('should work together on the same method', () => {
            APIRoute(
                'GET',
                '/admin/users',
                'v1',
                'v2',
            )(TestClass.prototype, 'testMethod');
            RequireRoles(GhostRole.Administrator)(
                TestClass.prototype,
                'testMethod',
            );

            const routes = Reflect.getMetadata(
                ROUTES_METADATA_KEY,
                TestClass.prototype,
            );
            const roles = Reflect.getMetadata(
                ROLES_METADATA_KEY,
                TestClass.prototype,
                'testMethod',
            );

            expect(routes[0]).toEqual({
                method: 'GET',
                path: '/.ghost/activitypub/:version/admin/users',
                methodName: 'testMethod',
                versions: ['v1', 'v2'],
            });
            expect(roles).toEqual([GhostRole.Administrator]);
        });
    });
});
