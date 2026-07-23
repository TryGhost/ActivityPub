import { z } from 'zod';

import type { AppContext } from '@/app';
import { getValue, isError } from '@/core/result';
import { APIRoute, RequireRoles } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';
import type { UserService } from '@/user/user.service';

const UpdatePreferencesSchema = z.strictObject({
    showSensitiveMedia: z.boolean(),
});

export class PreferencesController {
    constructor(private readonly userService: UserService) {}

    @APIRoute('GET', 'preferences')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleGetPreferences(ctx: AppContext) {
        const account = ctx.get('account');

        const userResult = await this.userService.getUserByAccountId(
            account.id,
        );
        if (isError(userResult)) {
            return new Response(null, { status: 500 });
        }

        const preferences = await this.userService.getPreferences(
            getValue(userResult).id,
        );
        if (isError(preferences)) {
            return new Response(null, { status: 500 });
        }

        return Response.json(getValue(preferences));
    }

    @APIRoute('PUT', 'preferences')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleUpdatePreferences(ctx: AppContext) {
        let body: unknown;

        try {
            body = await ctx.req.json();
        } catch {
            return new Response(null, { status: 400 });
        }

        const parsed = UpdatePreferencesSchema.safeParse(body);

        if (!parsed.success) {
            return new Response(null, { status: 400 });
        }
        const account = ctx.get('account');

        const userResult = await this.userService.getUserByAccountId(
            account.id,
        );
        if (isError(userResult)) {
            return new Response(null, { status: 500 });
        }

        const preferences = await this.userService.updatePreferences(
            getValue(userResult).id,
            parsed.data,
        );
        if (isError(preferences)) {
            return new Response(null, { status: 500 });
        }

        return Response.json(getValue(preferences));
    }
}
