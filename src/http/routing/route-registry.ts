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

    mountRoutes(
        app: Hono<{ Variables: HonoContextVariables }>,
        container: AwilixContainer,
    ): void {
        for (const route of this.routes) {
            const middleware = this.buildMiddleware(route, container);
            const method = route.method.toLowerCase() as
                | 'get'
                | 'post'
                | 'put'
                | 'delete';
            app[method](route.path, ...middleware);
        }
    }

    private buildMiddleware(
        route: RouteRegistration,
        container: AwilixContainer,
    ): MiddlewareHandler<{ Variables: HonoContextVariables }>[] {
        const middleware: MiddlewareHandler<{
            Variables: HonoContextVariables;
        }>[] = [];

        if (route.versions && route.versions.length > 0) {
            middleware.push(async (ctx: AppContext, next: Next) => {
                const requestVersion = ctx.req.param('version');
                if (!route.versions) {
                    throw new Error('RouteRegistration was modified');
                }

                if (!route.versions.includes(requestVersion)) {
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
            });
        }

        if (route.requiredRoles && route.requiredRoles.length > 0) {
            middleware.push(
                requireRole(...route.requiredRoles) as MiddlewareHandler<{
                    Variables: HonoContextVariables;
                }>,
            );
        }

        middleware.push((ctx: AppContext, next: Next) => {
            const controller = container.resolve(route.controllerToken);
            return Sentry.startSpan(
                {
                    op: 'controller.handle',
                    name: `${controller.constructor.name}.${route.methodName}`,
                },
                () => controller[route.methodName](ctx, next),
            );
        });

        return middleware;
    }
}
