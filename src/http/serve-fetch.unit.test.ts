import { describe, expect, it } from 'vitest';

import { createServeFetch } from './serve-fetch';

async function dispatch(environment: string | undefined, request: Request) {
    let receivedRequest: Request | undefined;

    const fetch = createServeFetch(environment, (request: Request) => {
        receivedRequest = request;
        return new Response();
    });

    await fetch(request);

    if (!receivedRequest) {
        throw new Error('Expected the wrapped fetch to be called');
    }

    return receivedRequest;
}

describe('createServeFetch', () => {
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
});
