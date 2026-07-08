import { describe, expect, it } from 'vitest';

import { behindProxy } from 'x-forwarded-fetch';

import { forceHttps } from './force-https';

describe('forceHttps', () => {
    it('should set the x-forwarded-proto header to https when it is missing', async () => {
        let receivedRequest: Request | undefined;

        const fetch = forceHttps((request: Request) => {
            receivedRequest = request;
        });

        await fetch(new Request('http://example.com/foo'));

        expect(receivedRequest?.headers.get('x-forwarded-proto')).toBe('https');
    });

    it('should override an x-forwarded-proto header of http', async () => {
        let receivedRequest: Request | undefined;

        const fetch = forceHttps((request: Request) => {
            receivedRequest = request;
        });

        await fetch(
            new Request('http://example.com/foo', {
                headers: {
                    'x-forwarded-proto': 'http',
                },
            }),
        );

        expect(receivedRequest?.headers.get('x-forwarded-proto')).toBe('https');
    });

    it('should result in an https request URL when composed with behindProxy', async () => {
        let receivedRequest: Request | undefined;

        const fetch = forceHttps(
            behindProxy((request: Request) => {
                receivedRequest = request;
                return new Response();
            }),
        );

        await fetch(new Request('http://example.com/foo'));

        expect(receivedRequest?.url).toBe('https://example.com/foo');
    });
});
