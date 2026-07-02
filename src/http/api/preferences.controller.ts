import { z } from 'zod';

import type { AppContext } from '@/app';
import { getValue, isError } from '@/core/result';
import { APIRoute, RequireRoles } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';
import type { PreferencesService } from '@/preferences/preferences.service';

const UpdatePreferencesSchema = z.strictObject({
    showSensitiveMedia: z.boolean(),
});

export class PreferencesController {
    constructor(private readonly preferencesService: PreferencesService) {}

    @APIRoute('GET', 'preferences')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleGetPreferences(ctx: AppContext) {
        const site = ctx.get('site');
        const preferences = await this.preferencesService.getForSite(site);

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

        const site = ctx.get('site');
        const preferences = await this.preferencesService.updateForSite(
            site,
            parsed.data,
        );

        if (isError(preferences)) {
            return new Response(null, { status: 500 });
        }

        return Response.json(getValue(preferences));
    }
}
