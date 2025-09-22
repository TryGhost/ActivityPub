# Use Decorator-based Routing

## Status

Proposed

## Context

Traditional web frameworks use imperative route registration which scatters route definitions and makes it hard to see all routes a controller handles.

## Decision

Use decorators with reflection for declarative route registration.

## Implementation

```typescript
// Routes defined via decorators
export class AccountController {
  @APIRoute('GET', 'accounts/:handle')
  async getAccount(ctx: AppContext): Promise<Response> {
    const { handle } = ctx.req.param();
    // implementation
  }

  @APIRoute('POST', 'accounts/:handle/follow')
  @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
  async followAccount(ctx: AppContext): Promise<Response> {
    // implementation with role check
  }
}

// Decorator definition
export function APIRoute(method: HTTPMethod, path: string, version = 'v1') {
  return function (target: any, propertyKey: string) {
    Reflect.defineMetadata('route', { method, path, version }, target, propertyKey);
  };
}

// Routes auto-discovered via reflection at startup