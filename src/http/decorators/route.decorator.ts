import 'reflect-metadata';

import type { GhostRole } from '@/http/middleware/role-guard';

export const ROUTES_METADATA_KEY = Symbol('routes');
export const ROLES_METADATA_KEY = Symbol('roles');
export const DEFAULT_API_VERSION = 'v1';

export function Route(method: string, path: string) {
    return (target: object, propertyKey: string) => {
        const existingRoutes =
            Reflect.getMetadata(ROUTES_METADATA_KEY, target) || [];
        existingRoutes.push({
            method,
            path,
            methodName: propertyKey,
        });
        Reflect.defineMetadata(ROUTES_METADATA_KEY, existingRoutes, target);
    };
}

export function APIRoute(method: string, path: string, ...versions: string[]) {
    if (path.startsWith('/')) {
        path = path.slice(1);
    }

    if (versions.length === 0) {
        versions = [DEFAULT_API_VERSION];
    }

    return (target: object, propertyKey: string) => {
        const existingRoutes =
            Reflect.getMetadata(ROUTES_METADATA_KEY, target) || [];
        existingRoutes.push({
            method,
            path: `/.ghost/activitypub/:version/${path}`,
            methodName: propertyKey,
            versions,
        });
        Reflect.defineMetadata(ROUTES_METADATA_KEY, existingRoutes, target);
    };
}

export function RequireRoles(...roles: GhostRole[]) {
    return (target: object, propertyKey: string) => {
        Reflect.defineMetadata(ROLES_METADATA_KEY, roles, target, propertyKey);
    };
}
