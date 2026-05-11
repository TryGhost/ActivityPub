import 'reflect-metadata';

import * as Sentry from '@sentry/node';
import type { AwilixContainer } from 'awilix';
import type { Handler, Hono, MiddlewareHandler, Next } from 'hono';

import type { AppContext, HonoContextVariables } from '@/app';
import {
    ROLES_METADATA_KEY,
    ROUTES_METADATA_KEY,
    type RouteMethod,
} from '@/http/decorators/route.decorator';
import type { GhostRole } from '@/http/middleware/role-guard';
import { requireRole } from '@/http/middleware/role-guard';

interface RouteRegistration {
    method: RouteMethod;
    path: string;
    controllerToken: string;
    methodName: string;
    requiredRoles?: GhostRole[];
    versions?: string[];
}

type AppEnv = { Variables: HonoContextVariables };
type AppHandler = Handler<AppEnv> | MiddlewareHandler<AppEnv>;
type AppHono = Hono<AppEnv>;

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
            app.on(route.method, route.path, ...handlers);
        }
    }

    private buildHandlers(
        route: RouteRegistration,
        container: AwilixContainer,
    ): AppHandler[] {
        const handlers: AppHandler[] = [];

        if (route.versions?.length) {
            handlers.push(this.buildVersionGuard(route));
        }

        if (route.requiredRoles?.length) {
            handlers.push(requireRole(...route.requiredRoles) as AppHandler);
        }

        handlers.push(this.buildHandler(route, container));

        return handlers;
    }

    private buildVersionGuard(route: RouteRegistration): AppHandler {
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
    ): AppHandler {
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
