import 'reflect-metadata';
import type { GhostRole } from '@/http/middleware/role-guard';

export const ROUTES_METADATA_KEY = Symbol('routes');
export const ROLES_METADATA_KEY = Symbol('roles');

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

export function RequireRoles(...roles: GhostRole[]) {
    return (target: object, propertyKey: string) => {
        Reflect.defineMetadata(ROLES_METADATA_KEY, roles, target, propertyKey);
    };
}
