import 'reflect-metadata';

import * as Sentry from '@sentry/node';
import type { AwilixContainer } from 'awilix';
import type { Hono, MiddlewareHandler, Next } from 'hono';

import type { AppContext, HonoContextVariables } from '@/app';
import {
    ROLES_METADATA_KEY,
    ROUTES_METADATA_KEY,
} from '@/http/decorators/route.decorator';
import type { GhostRole } from '@/http/middleware/role-guard';
import { requireRole } from '@/http/middleware/role-guard';

interface RouteRegistration {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    controllerToken: string;
    methodName: string;
    requiredRoles?: GhostRole[];
    versions?: string[];
}

type AppMiddleware = MiddlewareHandler<{ Variables: HonoContextVariables }>;
type AppHono = Hono<{ Variables: HonoContextVariables }>;

export class RouteRegistry {
    private routes: RouteRegistration[] = [];

    registerRoute(registration: RouteRegistration): void {
        this.routes.push(registration);
    }

    registerController(
        controllerToken: string,
        ControllerClass: { prototype: object },
    ): void {
        const routes =
            Reflect.getMetadata(
                ROUTES_METADATA_KEY,
                ControllerClass.prototype,
            ) || [];

        for (const route of routes) {
            const roles = Reflect.getMetadata(
                ROLES_METADATA_KEY,
                ControllerClass.prototype,
                route.methodName,
            );

            this.registerRoute({
                method: route.method,
                path: route.path,
                controllerToken,
                methodName: route.methodName,
                requiredRoles: roles,
                versions: route.versions,
            });
        }
    }

    mountRoutes(app: AppHono, container: AwilixContainer): void {
        for (const route of this.routes) {
            const handlers = this.buildHandlers(route, container);
            switch (route.method) {
                case 'GET':
                    app.get(route.path, ...handlers);
                    break;
                case 'POST':
                    app.post(route.path, ...handlers);
                    break;
                case 'PUT':
                    app.put(route.path, ...handlers);
                    break;
                case 'DELETE':
                    app.delete(route.path, ...handlers);
                    break;
            }
        }
    }

    private buildHandlers(
        route: RouteRegistration,
        container: AwilixContainer,
    ): [AppMiddleware, ...AppMiddleware[]] {
        const handler = this.buildHandler(route, container);
        const versionMw = route.versions?.length
            ? this.buildVersionGuard(route)
            : null;
        const roleMw = route.requiredRoles?.length
            ? (requireRole(...route.requiredRoles) as AppMiddleware)
            : null;

        if (versionMw && roleMw) return [versionMw, roleMw, handler];
        if (versionMw) return [versionMw, handler];
        if (roleMw) return [roleMw, handler];
        return [handler];
    }

    private buildVersionGuard(route: RouteRegistration): AppMiddleware {
        return async (ctx: AppContext, next: Next) => {
            const requestVersion = ctx.req.param('version');
            if (!route.versions) {
                throw new Error('RouteRegistration was modified');
            }
            if (!requestVersion || !route.versions.includes(requestVersion)) {
                return ctx.json(
                    {
                        message: `Version ${requestVersion} is not supported.`,
                        code: 'INVALID_VERSION',
                        requestedVersion: requestVersion,
                        supportedVersions: route.versions,
                    },
                    410,
                );
            }
            return await next();
        };
    }

    private buildHandler(
        route: RouteRegistration,
        container: AwilixContainer,
    ): AppMiddleware {
        return (ctx: AppContext, next: Next) => {
            const controller = container.resolve(route.controllerToken);
            return Sentry.startSpan(
                {
                    op: 'controller.handle',
                    name: `${controller.constructor.name}.${route.methodName}`,
                },
                () => controller[route.methodName](ctx, next),
            );
        };
    }
}
