import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveTxt } from 'node:dns/promises';

import { UrlError, validatePublicUrl } from '@fedify/vocab-runtime';
import type { Logger } from '@logtape/logtape';

import {
    getError,
    getValue,
    isError,
    type Ok,
    type Error as ResultError,
} from '@/core/result';
import {
    AtprotoHandleResolver,
    MAX_WELL_KNOWN_REDIRECTS,
} from '@/integration/atproto-handle.resolver';

vi.mock('node:dns/promises', () => ({
    resolveTxt: vi.fn(),
}));

vi.mock('@fedify/vocab-runtime', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@fedify/vocab-runtime')>()),
    validatePublicUrl: vi.fn(),
}));

function dnsError(code: string) {
    return Object.assign(new Error(code), { code });
}

describe('AtprotoHandleResolver', () => {
    let resolver: AtprotoHandleResolver;

    beforeEach(() => {
        resolver = new AtprotoHandleResolver({
            info: vi.fn(),
            warn: vi.fn(),
        } as unknown as Logger);

        vi.stubGlobal('fetch', vi.fn());
        vi.mocked(validatePublicUrl).mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.mocked(resolveTxt).mockReset();
        vi.mocked(validatePublicUrl).mockReset();
    });

    describe('resolveDns', () => {
        it('returns the DIDs from the _atproto TXT records', async () => {
            vi.mocked(resolveTxt).mockResolvedValue([
                ['did=did:plc:abc123'],
                ['v=spf1 -all'],
            ]);

            const result = await resolver.resolveDns('example.com');

            expect(resolveTxt).toHaveBeenCalledWith('_atproto.example.com');
            expect(getValue(result as Ok<string[]>)).toEqual([
                'did:plc:abc123',
            ]);
        });

        it('returns every DID when there are multiple records', async () => {
            vi.mocked(resolveTxt).mockResolvedValue([
                ['did=did:plc:abc123'],
                ['did=did:plc:', 'def456'],
            ]);

            const result = await resolver.resolveDns('example.com');

            expect(getValue(result as Ok<string[]>)).toEqual([
                'did:plc:abc123',
                'did:plc:def456',
            ]);
        });

        it.each(['ENOTFOUND', 'ENODATA'])(
            'returns no DIDs when there is no record (%s)',
            async (code) => {
                vi.mocked(resolveTxt).mockRejectedValue(dnsError(code));

                const result = await resolver.resolveDns('example.com');

                expect(getValue(result as Ok<string[]>)).toEqual([]);
            },
        );

        it.each(['ESERVFAIL', 'ETIMEOUT', 'EREFUSED'])(
            'returns an error when the lookup fails (%s)',
            async (code) => {
                vi.mocked(resolveTxt).mockRejectedValue(dnsError(code));

                const result = await resolver.resolveDns('example.com');

                expect(isError(result)).toBe(true);
                expect(getError(result as ResultError<unknown>)).toEqual({
                    type: 'dns-error',
                    code,
                });
            },
        );
    });

    describe('resolveHttps', () => {
        beforeEach(() => {
            vi.stubEnv('NODE_ENV', 'production');
            vi.stubEnv('ALLOW_PRIVATE_ADDRESS', 'false');
        });

        afterEach(() => {
            vi.unstubAllEnvs();
        });

        function redirect(location: string) {
            return new Response(null, { status: 301, headers: { location } });
        }

        function fetchedUrls() {
            return vi.mocked(fetch).mock.calls.map(([url]) => String(url));
        }

        it('returns the DID served at the well-known URL', async () => {
            vi.mocked(fetch).mockResolvedValue(
                new Response('did:plc:abc123\n', { status: 200 }),
            );

            const did = await resolver.resolveHttps('example.com');

            expect(did).toBe('did:plc:abc123');
            expect(fetchedUrls()).toEqual([
                'https://example.com/.well-known/atproto-did',
            ]);
            expect(fetch).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ redirect: 'manual' }),
            );
        });

        it('follows redirects', async () => {
            vi.mocked(fetch)
                .mockResolvedValueOnce(
                    redirect('https://www.example.com/.well-known/atproto-did'),
                )
                .mockResolvedValueOnce(
                    new Response('did:plc:abc123', { status: 200 }),
                );

            const did = await resolver.resolveHttps('example.com');

            expect(did).toBe('did:plc:abc123');
            expect(fetchedUrls()).toEqual([
                'https://example.com/.well-known/atproto-did',
                'https://www.example.com/.well-known/atproto-did',
            ]);
            expect(validatePublicUrl).toHaveBeenCalledWith(
                'https://www.example.com/.well-known/atproto-did',
            );
        });

        it('follows relative redirects', async () => {
            vi.mocked(fetch)
                .mockResolvedValueOnce(redirect('/.well-known/atproto-did/'))
                .mockResolvedValueOnce(
                    new Response('did:plc:abc123', { status: 200 }),
                );

            expect(await resolver.resolveHttps('example.com')).toBe(
                'did:plc:abc123',
            );
            expect(fetchedUrls()[1]).toBe(
                'https://example.com/.well-known/atproto-did/',
            );
        });

        it('does not follow redirects to plain HTTP', async () => {
            vi.mocked(fetch).mockResolvedValueOnce(
                redirect('http://example.com/.well-known/atproto-did'),
            );

            expect(await resolver.resolveHttps('example.com')).toBeNull();
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        it('does not request private addresses', async () => {
            vi.mocked(fetch).mockResolvedValueOnce(
                redirect('https://169.254.169.254/latest/meta-data'),
            );
            vi.mocked(validatePublicUrl).mockImplementation(async (url) => {
                if (url.includes('169.254.169.254')) {
                    throw new UrlError('Invalid or private address');
                }
            });

            expect(await resolver.resolveHttps('example.com')).toBeNull();
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        it('does not request a domain that resolves to a private address', async () => {
            vi.mocked(validatePublicUrl).mockRejectedValue(
                new UrlError('Invalid or private address'),
            );

            expect(await resolver.resolveHttps('internal.example')).toBeNull();
            expect(fetch).not.toHaveBeenCalled();
        });

        it('allows private addresses in local environments when configured to', async () => {
            vi.stubEnv('NODE_ENV', 'testing');
            vi.stubEnv('ALLOW_PRIVATE_ADDRESS', 'true');
            vi.mocked(fetch).mockResolvedValue(
                new Response('did:plc:abc123', { status: 200 }),
            );

            expect(await resolver.resolveHttps('example.com')).toBe(
                'did:plc:abc123',
            );
            expect(validatePublicUrl).not.toHaveBeenCalled();
        });

        it('does not allow private addresses in production even when configured to', async () => {
            vi.stubEnv('ALLOW_PRIVATE_ADDRESS', 'true');
            vi.mocked(fetch).mockResolvedValue(
                new Response('did:plc:abc123', { status: 200 }),
            );

            await resolver.resolveHttps('example.com');

            expect(validatePublicUrl).toHaveBeenCalledWith(
                'https://example.com/.well-known/atproto-did',
            );
        });

        it('gives up after too many redirects', async () => {
            vi.mocked(fetch).mockImplementation(async () =>
                redirect('https://example.com/.well-known/atproto-did'),
            );

            expect(await resolver.resolveHttps('example.com')).toBeNull();
            expect(fetch).toHaveBeenCalledTimes(MAX_WELL_KNOWN_REDIRECTS + 1);
        });

        it('returns null for a redirect without a location', async () => {
            vi.mocked(fetch).mockResolvedValue(
                new Response(null, { status: 302 }),
            );

            expect(await resolver.resolveHttps('example.com')).toBeNull();
        });

        it('returns null when nothing is served', async () => {
            vi.mocked(fetch).mockResolvedValue(
                new Response('Not found', { status: 404 }),
            );

            expect(await resolver.resolveHttps('example.com')).toBeNull();
        });

        it('returns null when the response is not a DID', async () => {
            vi.mocked(fetch).mockResolvedValue(
                new Response('<html>Hello</html>', { status: 200 }),
            );

            expect(await resolver.resolveHttps('example.com')).toBeNull();
        });

        it('returns null when the request fails', async () => {
            vi.mocked(fetch).mockRejectedValue(new Error('timeout'));

            expect(await resolver.resolveHttps('example.com')).toBeNull();
        });
    });
});
