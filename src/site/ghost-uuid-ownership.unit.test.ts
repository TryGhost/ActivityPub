import { describe, expect, it } from 'vitest';

import { HTTPError, TimeoutError } from 'ky';

import type { SiteSettings } from '@/helpers/ghost';
import { classifyGhostUuidOwnership } from '@/site/ghost-uuid-ownership';

const HOST = 'previous-owner.tld';
const UUID = '3955fb96-837a-44b2-bb58-e20c082bc992';

function settingsWithUuid(uuid: string | null): SiteSettings {
    return {
        site: {
            description: null,
            icon: null,
            title: 'Previous owner',
            cover_image: null,
            site_uuid: uuid,
        },
    };
}

function networkError(code: string | undefined): Error {
    // Mirrors how undici / Node's fetch surfaces network errors: a
    // top-level `TypeError: fetch failed` with the system error nested
    // in `cause`.
    const cause = code
        ? Object.assign(new Error('underlying network error'), { code })
        : new Error('underlying network error');
    return new TypeError('fetch failed', { cause });
}

function timeoutError(): TimeoutError {
    const request = new Request(`https://${HOST}/ghost/api/admin/site/`);
    return new TimeoutError(request);
}

function httpError(status: number): HTTPError {
    const response = new Response('', { status });
    const request = new Request(`https://${HOST}/ghost/api/admin/site/`);
    // The options object is mostly internal to ky; an empty object is
    // sufficient for the classifier, which only reads `response.status`.
    return new HTTPError(response, request, {} as never);
}

describe('classifyGhostUuidOwnership', () => {
    describe('definitive responses', () => {
        it('returns still-claims when the host serves a matching site_uuid', async () => {
            const result = await classifyGhostUuidOwnership(
                HOST,
                UUID,
                async () => settingsWithUuid(UUID),
            );

            expect(result).toEqual({ type: 'still-claims' });
        });

        it('returns released when the host serves a different site_uuid', async () => {
            const result = await classifyGhostUuidOwnership(
                HOST,
                UUID,
                async () => settingsWithUuid('a-different-uuid'),
            );

            expect(result).toEqual({
                type: 'released',
                reason: 'different-uuid',
            });
        });

        it('returns released when the host serves no site_uuid', async () => {
            const result = await classifyGhostUuidOwnership(
                HOST,
                UUID,
                async () => settingsWithUuid(null),
            );

            expect(result).toEqual({
                type: 'released',
                reason: 'different-uuid',
            });
        });
    });

    describe('network errors', () => {
        it('returns released when DNS lookup fails (ENOTFOUND)', async () => {
            const result = await classifyGhostUuidOwnership(
                HOST,
                UUID,
                async () => {
                    throw networkError('ENOTFOUND');
                },
            );

            expect(result).toEqual({
                type: 'released',
                reason: 'dns-not-found',
            });
        });

        it('returns unverifiable on transient DNS failure (EAI_AGAIN)', async () => {
            const result = await classifyGhostUuidOwnership(
                HOST,
                UUID,
                async () => {
                    throw networkError('EAI_AGAIN');
                },
            );

            expect(result).toEqual({
                type: 'unverifiable',
                reason: 'network-error',
            });
        });

        it('returns released when the connection is refused (ECONNREFUSED)', async () => {
            const result = await classifyGhostUuidOwnership(
                HOST,
                UUID,
                async () => {
                    throw networkError('ECONNREFUSED');
                },
            );

            expect(result).toEqual({
                type: 'released',
                reason: 'connection-refused',
            });
        });

        it('returns unverifiable for other network errors', async () => {
            const result = await classifyGhostUuidOwnership(
                HOST,
                UUID,
                async () => {
                    throw networkError('ECONNRESET');
                },
            );

            expect(result).toEqual({
                type: 'unverifiable',
                reason: 'network-error',
            });
        });

        it('reads the system error code from a deeply nested cause chain', async () => {
            const inner = Object.assign(new Error('underlying'), {
                code: 'ENOTFOUND',
            });
            const middle = new Error('intermediate', { cause: inner });
            const err = new TypeError('fetch failed', { cause: middle });

            const result = await classifyGhostUuidOwnership(
                HOST,
                UUID,
                async () => {
                    throw err;
                },
            );

            expect(result).toEqual({
                type: 'released',
                reason: 'dns-not-found',
            });
        });
    });

    describe('timeouts', () => {
        it('returns unverifiable on timeout', async () => {
            const result = await classifyGhostUuidOwnership(
                HOST,
                UUID,
                async () => {
                    throw timeoutError();
                },
            );

            expect(result).toEqual({
                type: 'unverifiable',
                reason: 'timeout',
            });
        });
    });

    describe('HTTP status errors', () => {
        it('returns released on 404', async () => {
            const result = await classifyGhostUuidOwnership(
                HOST,
                UUID,
                async () => {
                    throw httpError(404);
                },
            );

            expect(result).toEqual({
                type: 'released',
                reason: 'admin-api-gone',
            });
        });

        it('returns released on 403', async () => {
            const result = await classifyGhostUuidOwnership(
                HOST,
                UUID,
                async () => {
                    throw httpError(403);
                },
            );

            expect(result).toEqual({
                type: 'released',
                reason: 'admin-api-gone',
            });
        });

        it('returns unverifiable on 500', async () => {
            const result = await classifyGhostUuidOwnership(
                HOST,
                UUID,
                async () => {
                    throw httpError(500);
                },
            );

            expect(result).toEqual({
                type: 'unverifiable',
                reason: 'server-error',
            });
        });

        it('returns unverifiable on 503', async () => {
            const result = await classifyGhostUuidOwnership(
                HOST,
                UUID,
                async () => {
                    throw httpError(503);
                },
            );

            expect(result).toEqual({
                type: 'unverifiable',
                reason: 'server-error',
            });
        });
    });

    describe('parse errors', () => {
        it('returns released when the response body is not valid JSON', async () => {
            const result = await classifyGhostUuidOwnership(
                HOST,
                UUID,
                async () => {
                    throw new SyntaxError(
                        'Unexpected token < in JSON at position 0',
                    );
                },
            );

            expect(result).toEqual({
                type: 'released',
                reason: 'non-ghost-response',
            });
        });
    });

    describe('unknown errors', () => {
        it('returns unverifiable for arbitrary errors', async () => {
            const result = await classifyGhostUuidOwnership(
                HOST,
                UUID,
                async () => {
                    throw new Error('something unexpected');
                },
            );

            expect(result).toEqual({
                type: 'unverifiable',
                reason: 'unknown',
            });
        });
    });
});
