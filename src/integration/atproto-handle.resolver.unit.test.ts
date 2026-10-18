import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveTxt } from 'node:dns/promises';

import type { Logger } from '@logtape/logtape';

import {
    getError,
    getValue,
    isError,
    type Ok,
    type Error as ResultError,
} from '@/core/result';
import { AtprotoHandleResolver } from '@/integration/atproto-handle.resolver';

vi.mock('node:dns/promises', () => ({
    resolveTxt: vi.fn(),
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
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.mocked(resolveTxt).mockReset();
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
        it('returns the DID served at the well-known URL', async () => {
            vi.mocked(fetch).mockResolvedValue(
                new Response('did:plc:abc123\n', { status: 200 }),
            );

            const did = await resolver.resolveHttps('example.com');

            expect(did).toBe('did:plc:abc123');
            expect(fetch).toHaveBeenCalledWith(
                'https://example.com/.well-known/atproto-did',
                expect.objectContaining({ redirect: 'follow' }),
            );
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
