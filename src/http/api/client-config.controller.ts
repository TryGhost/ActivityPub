import type { AppContext } from '@/app';
import { APIRoute } from '@/http/decorators/route.decorator';

export class ClientConfigController {
    @APIRoute('GET', 'client-config', 'stable')
    async handleGetClientConfig(_ctx: AppContext) {
        const clientConfig = {
            requiredVersion: '^1.0.0',
            cdnUrl: 'https://cdn.jsdelivr.net/ghost/admin-x-activitypub@1/dist/admin-x-activitypub.js',
        };

        return new Response(JSON.stringify(clientConfig), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
}
