import { describe, expect, it, vi } from 'vitest';

import { createFetchHandler } from './fetch-handler';

async function dispatch(environment: string | undefined, request: Request) {
    let receivedRequest: Request | undefined;

    const fetch = createFetchHandler(environment, (request: Request) => {
        receivedRequest = request;
        return new Response();
    });

    await fetch(request);

    if (!receivedRequest) {
        throw new Error('Expected the wrapped fetch to be called');
    }

    return receivedRequest;
}

describe('createFetchHandler', () => {
    for (const environment of ['staging', 'production']) {
        it(`should force an https request URL in ${environment} when x-forwarded-proto is missing`, async () => {
            const request = await dispatch(
                environment,
                new Request('http://example.com/foo'),
            );

            expect(request.url).toBe('https://example.com/foo');
        });

        it(`should force an https request URL in ${environment} when x-forwarded-proto is http`, async () => {
            const request = await dispatch(
                environment,
                new Request('http://example.com/foo', {
                    headers: {
                        'x-forwarded-proto': 'http',
                    },
                }),
            );

            expect(request.url).toBe('https://example.com/foo');
        });
    }

    it('should force an https request URL when NODE_ENV is unset or unrecognised', async () => {
        for (const environment of [undefined, '', 'prod']) {
            const request = await dispatch(
                environment,
                new Request('http://example.com/foo'),
            );

            expect(request.url).toBe('https://example.com/foo');
        }
    });

    for (const environment of ['development', 'testing']) {
        it(`should keep an http request URL in ${environment}`, async () => {
            const request = await dispatch(
                environment,
                new Request('http://example.com/foo'),
            );

            expect(request.url).toBe('http://example.com/foo');
        });

        it(`should still honour x-forwarded-proto in ${environment}`, async () => {
            const request = await dispatch(
                environment,
                new Request('http://example.com/foo', {
                    headers: {
                        'x-forwarded-proto': 'https',
                    },
                }),
            );

            expect(request.url).toBe('https://example.com/foo');
        });
    }

    it('should apply x-forwarded-host to the request URL', async () => {
        const request = await dispatch(
            'production',
            new Request('http://internal.host/foo', {
                headers: {
                    'x-forwarded-host': 'example.com',
                },
            }),
        );

        expect(request.url).toBe('https://example.com/foo');
    });

    it('should force the accept header in every environment', async () => {
        for (const environment of ['development', 'production']) {
            const request = await dispatch(
                environment,
                new Request('http://example.com/foo', {
                    headers: {
                        accept: 'text/html',
                    },
                }),
            );

            expect(request.headers.get('accept')).toBe(
                'application/activity+json',
            );
        }
    });

    it('should preserve the body of a POST request', async () => {
        const body = JSON.stringify({ type: 'Create', id: 'https://a.b/c' });

        const request = await dispatch(
            'production',
            new Request('http://example.com/inbox', {
                method: 'POST',
                headers: { 'content-type': 'application/ld+json' },
                body,
            }),
        );

        expect(request.method).toBe('POST');
        expect(await request.text()).toBe(body);
    });

    // Node >= 24.16.0 permanently retains any body that goes through
    // Blob.prototype.stream() (https://github.com/nodejs/node/issues/63574),
    // which is why the vendored x-forwarded-request passes bytes instead of a
    // Blob. Guard against the Blob path creeping back in.
    it('should not stream the request body through a Blob', async () => {
        const streamSpy = vi.spyOn(Blob.prototype, 'stream');

        try {
            await dispatch(
                'production',
                new Request('http://example.com/inbox', {
                    method: 'POST',
                    headers: { 'content-type': 'application/ld+json' },
                    body: '{"type":"Like"}',
                }),
            );

            expect(streamSpy).not.toHaveBeenCalled();
        } finally {
            streamSpy.mockRestore();
        }
    });
});
