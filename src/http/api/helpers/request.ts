import type { AppContext } from '@/app';

export class MissingRequiredParamError extends Error {
    constructor(readonly paramName: string) {
        super(`Missing required URL parameter: ${paramName}`);
        this.name = 'MissingRequiredParamError';
    }
}

export function requireParam(ctx: AppContext, name: string): string {
    const value = ctx.req.param(name);
    if (!value) {
        throw new MissingRequiredParamError(name);
    }
    return value;
}
