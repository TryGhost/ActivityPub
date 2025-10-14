import { describe, expect, it } from 'vitest';

import { Hono } from 'hono';

import { createDeploymentHeadersMiddleware } from './deployment-headers';

describe('createDeploymentHeadersMiddleware', () => {
    it('should copy the "X-ActivityPub-PR" header to the response in staging environment', async () => {
        const app = new Hono();

        app.use(createDeploymentHeadersMiddleware('staging'));

        app.get('/test', (c) => c.text('ok'));

        const res = await app.request('/test', {
            headers: {
                'X-ActivityPub-PR': '123',
            },
        });

        expect(res.headers.get('X-ActivityPub-PR')).toBe('123');
    });

    it('should copy the "X-ActivityPub-Commit" header to the response in staging environment', async () => {
        const app = new Hono();

        app.use(createDeploymentHeadersMiddleware('staging'));

        app.get('/test', (c) => c.text('ok'));

        const res = await app.request('/test', {
            headers: {
                'X-ActivityPub-Commit': 'abc123',
            },
        });

        expect(res.headers.get('X-ActivityPub-Commit')).toBe('abc123');
    });

    it('should not copy headers in production environment', async () => {
        const app = new Hono();

        app.use(createDeploymentHeadersMiddleware('production'));

        app.get('/test', (c) => c.text('ok'));

        const res = await app.request('/test', {
            headers: {
                'X-ActivityPub-PR': '123',
                'X-ActivityPub-Commit': 'abc123',
            },
        });

        expect(res.headers.get('X-ActivityPub-PR')).toBeNull();
        expect(res.headers.get('X-ActivityPub-Commit')).toBeNull();
    });

    it('should handle missing headers gracefully', async () => {
        const app = new Hono();

        app.use(createDeploymentHeadersMiddleware('staging'));

        app.get('/test', (c) => c.text('ok'));

        const res = await app.request('/test');

        expect(res.headers.get('X-ActivityPub-PR')).toBeNull();
        expect(res.headers.get('X-ActivityPub-Commit')).toBeNull();
        expect(res.status).toBe(200);
    });

    it('should handle case-insensitive request headers', async () => {
        const app = new Hono();

        app.use(createDeploymentHeadersMiddleware('staging'));

        app.get('/test', (c) => c.text('ok'));

        const res = await app.request('/test', {
            headers: {
                'x-activitypub-pr': '123',
                'x-activitypub-commit': 'abc123',
            },
        });

        expect(res.headers.get('X-ActivityPub-PR')).toBe('123');
        expect(res.headers.get('X-ActivityPub-Commit')).toBe('abc123');
    });
});
