import app from './app';
import { serve } from '@hono/node-server';
import { behindProxy } from 'x-forwarded-fetch';

function forceAcceptHeader(fn: (req: Request) => unknown) {
    return function (request: Request) {
        request.headers.set('accept', 'application/activity+json');
        return fn(request);
    };
}

serve(
    {
        fetch: forceAcceptHeader(behindProxy(app.fetch)),
        port: parseInt(process.env.PORT || '8080'),
    },
    function (info) {
        console.log(`listening on ${info.address}:${info.port}`);
    },
);

process.on('SIGINT', () => process.exit(0));
