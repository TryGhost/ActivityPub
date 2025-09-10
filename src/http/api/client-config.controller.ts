import type { AppContext } from '@/app';
import { APIRoute } from '@/http/decorators/route.decorator';

export class ClientConfigController {
    @APIRoute('GET', 'client-config', 'stable')
    async handleGetClientConfig(_ctx: AppContext) {
        const major = 1;
        const name = 'admin-x-activitypub';
        const client = {
            name,
            version: `^${major}.0.0`,
            cdnUrl: `https://cdn.jsdelivr.net/ghost/${name}@${major}/dist/${name}.js`,
        };

        return new Response(JSON.stringify({ client }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
}
