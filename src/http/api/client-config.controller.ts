import type { AppContext } from '@/app';
import { Route } from '@/http/decorators/route.decorator';

export class ClientConfigController {
    @Route('GET', '/.ghost/activitypub/stable/client-config')
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
