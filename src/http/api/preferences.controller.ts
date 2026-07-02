import type { Knex } from 'knex';
import { z } from 'zod';

import type { AppContext } from '@/app';
import { APIRoute, RequireRoles } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';

const UpdatePreferencesSchema = z
    .object({
        showSensitiveMedia: z.boolean(),
    })
    .strict();

export class PreferencesController {
    constructor(private readonly db: Knex) {}

    @APIRoute('GET', 'preferences')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleGetPreferences(ctx: AppContext) {
        const preferences = await this.getPreferences(ctx);

        return Response.json(preferences);
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

        await this.db('users').where({ site_id: site.id }).update({
            show_sensitive_media: parsed.data.showSensitiveMedia,
        });

        return Response.json({
            showSensitiveMedia: parsed.data.showSensitiveMedia,
        });
    }

    private async getPreferences(ctx: AppContext) {
        const site = ctx.get('site');

        const user = await this.db('users')
            .select('show_sensitive_media')
            .where({ site_id: site.id })
            .first();

        return {
            showSensitiveMedia: Boolean(user?.show_sensitive_media),
        };
    }
}
