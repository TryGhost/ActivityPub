import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    type MockInstance,
    vi,
} from 'vitest';

import type {
    KvKey,
    KvStore,
    KvStoreListEntry,
    KvStoreSetOptions,
} from '@fedify/fedify';
import type { Logger } from '@logtape/logtape';
import { Hono } from 'hono';
import {
    type CryptoKey,
    exportJWK,
    exportSPKI,
    generateKeyPair,
    importJWK,
    type JWK,
    SignJWT,
} from 'jose';

import type { HonoContextVariables } from '@/app';
import { createRoleMiddleware } from '@/http/middleware/role-guard';

type TestKey = {
    kid: string;
    privateKey: CryptoKey;
    privateJwk: JWK;
    publicKey: CryptoKey;
    jwk: JWK;
};

async function createTestKey(kid: string): Promise<TestKey> {
    const { privateKey, publicKey } = await generateKeyPair('RS256', {
        extractable: true,
    });

    return {
        kid,
        privateKey,
        publicKey,
        privateJwk: await exportJWK(privateKey),
        jwk: { ...(await exportJWK(publicKey)), kid, use: 'sig', alg: 'RS256' },
    };
}

async function signToken(
    key: TestKey,
    {
        kid = key.kid,
        alg = 'RS256',
        expiresIn = '5m',
    }: { kid?: string | null; alg?: string; expiresIn?: string } = {},
) {
    const signingKey =
        alg === 'RS256'
            ? key.privateKey
            : await importJWK({ ...key.privateJwk, alg: undefined }, alg);

    return new SignJWT({ role: 'Owner' })
        .setProtectedHeader(kid === null ? { alg } : { alg, kid })
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(signingKey);
}

/**
 * In-memory KvStore whose TTLs are driven by the test's clock
 */
class FakeKvStore implements KvStore {
    private entries = new Map<
        string,
        { value: unknown; expiresAt: number | null }
    >();

    constructor(private readonly now: () => number) {}

    async get<T = unknown>(key: KvKey): Promise<T | undefined> {
        const entry = this.entries.get(JSON.stringify(key));

        if (!entry) {
            return undefined;
        }

        if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
            this.entries.delete(JSON.stringify(key));
            return undefined;
        }

        return entry.value as T;
    }

    async set(key: KvKey, value: unknown, options?: KvStoreSetOptions) {
        this.entries.set(JSON.stringify(key), {
            value,
            expiresAt: options?.ttl
                ? this.now() + options.ttl.total('milliseconds')
                : null,
        });
    }

    async delete(key: KvKey) {
        this.entries.delete(JSON.stringify(key));
    }

    async *list(): AsyncIterable<KvStoreListEntry> {}
}

const HOST = 'example.com';
const KEY_SET_TTL = Temporal.Duration.from({ hours: 1 });
const REFETCH_COOLDOWN_MS = 30_000;

describe('createRoleMiddleware', () => {
    let clock: number;
    let kv: FakeKvStore;
    let servedKeys: JWK[];
    let fetchMock: MockInstance<typeof fetch>;
    let app: Hono<{ Variables: HonoContextVariables }>;

    let oldKey: TestKey;
    let newKey: TestKey;

    beforeEach(async () => {
        clock = Date.UTC(2026, 0, 1);
        kv = new FakeKvStore(() => clock);

        oldKey = await createTestKey('old-key');
        newKey = await createTestKey('new-key');
        servedKeys = [oldKey.jwk];

        fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(async () =>
                Response.json({ keys: servedKeys }),
            );

        app = new Hono<{ Variables: HonoContextVariables }>();
        app.use(async (c, next) => {
            c.set('logger', {
                info: vi.fn(),
                error: vi.fn(),
            } as unknown as Logger);

            await next();
        });
        app.use(
            createRoleMiddleware(kv, {
                keySetTtl: KEY_SET_TTL,
                refetchCooldownMs: REFETCH_COOLDOWN_MS,
                now: () => clock,
            }),
        );
        app.get('/test', (c) => c.json({ role: c.get('role') }));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    async function request(token: string) {
        return app.request('/test', {
            headers: {
                host: HOST,
                authorization: `Bearer ${token}`,
            },
        });
    }

    async function getRole(token: string) {
        const res = await request(token);
        expect(res.status).toBe(200);

        return ((await res.json()) as { role: string }).role;
    }

    function getFetchHeaders(call: number) {
        const init = fetchMock.mock.calls[call][1];

        return new Headers(init?.headers);
    }

    it('fetches the key set once and serves later requests from the cache', async () => {
        expect(await getRole(await signToken(oldKey))).toBe('Owner');
        expect(await getRole(await signToken(oldKey))).toBe('Owner');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            `http://${HOST}/ghost/.well-known/jwks.json`,
        );
        expect(getFetchHeaders(0).get('cache-control')).toBeNull();
    });

    it('verifies a token signed by a key that is not first in the key set', async () => {
        servedKeys = [oldKey.jwk, newKey.jwk];

        expect(await getRole(await signToken(newKey))).toBe('Owner');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('refetches the key set when the token is signed by a key missing from the cache', async () => {
        expect(await getRole(await signToken(oldKey))).toBe('Owner');

        // Ghost publishes the new key and starts signing with it
        servedKeys = [newKey.jwk, oldKey.jwk];

        expect(await getRole(await signToken(newKey))).toBe('Owner');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(getFetchHeaders(1).get('cache-control')).toBe('no-cache');

        // The refetched key set is cached
        expect(await getRole(await signToken(newKey))).toBe('Owner');
        expect(await getRole(await signToken(oldKey))).toBe('Owner');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('rejects a token whose key is still missing after refetching', async () => {
        const unknownKey = await createTestKey('unknown-key');

        expect(await getRole(await signToken(unknownKey))).toBe('Anonymous');
        // Initial fetch, then a single refetch for the unknown key
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not refetch for an unknown key within the cooldown', async () => {
        const unknownKey = await createTestKey('unknown-key');
        expect(await getRole(await signToken(oldKey))).toBe('Owner');

        expect(await getRole(await signToken(unknownKey))).toBe('Anonymous');
        expect(fetchMock).toHaveBeenCalledTimes(2);

        clock += REFETCH_COOLDOWN_MS - 1;
        servedKeys = [unknownKey.jwk];

        expect(await getRole(await signToken(unknownKey))).toBe('Anonymous');
        expect(fetchMock).toHaveBeenCalledTimes(2);

        clock += 1;

        expect(await getRole(await signToken(unknownKey))).toBe('Owner');
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('tries every key for a token without a kid', async () => {
        servedKeys = [oldKey.jwk, newKey.jwk];

        expect(await getRole(await signToken(newKey, { kid: null }))).toBe(
            'Owner',
        );
        expect(await getRole(await signToken(oldKey, { kid: null }))).toBe(
            'Owner',
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects a token without a kid that no key verifies, without refetching', async () => {
        const unknownKey = await createTestKey('unknown-key');

        expect(await getRole(await signToken(unknownKey, { kid: null }))).toBe(
            'Anonymous',
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('refetches the key set once the cached copy has expired', async () => {
        expect(await getRole(await signToken(oldKey))).toBe('Owner');

        clock += KEY_SET_TTL.total('milliseconds') - 1;
        expect(await getRole(await signToken(oldKey))).toBe('Owner');
        expect(fetchMock).toHaveBeenCalledTimes(1);

        clock += 1;
        expect(await getRole(await signToken(oldKey))).toBe('Owner');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(getFetchHeaders(1).get('cache-control')).toBeNull();
    });

    it('rejects a token signed with an algorithm other than RS256, without refetching', async () => {
        const rs512Token = await signToken(oldKey, { alg: 'RS512' });

        // Algorithm confusion: an HMAC token keyed with the public key
        const hs256Token = await new SignJWT({ role: 'Owner' })
            .setProtectedHeader({ alg: 'HS256', kid: oldKey.kid })
            .setExpirationTime('5m')
            .sign(new TextEncoder().encode(await exportSPKI(oldKey.publicKey)));

        expect(await getRole(rs512Token)).toBe('Anonymous');
        expect(await getRole(hs256Token)).toBe('Anonymous');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects a token with a bad signature for a known kid, without refetching', async () => {
        // Signed by a different key but claiming to be the old key
        const token = await signToken(newKey, { kid: oldKey.kid });

        expect(await getRole(token)).toBe('Anonymous');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects an expired token', async () => {
        const token = await new SignJWT({ role: 'Owner' })
            .setProtectedHeader({ alg: 'RS256', kid: oldKey.kid })
            .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
            .sign(oldKey.privateKey);

        expect(await getRole(token)).toBe('Anonymous');
    });

    it('retries fetching the key set when the fetch fails', async () => {
        fetchMock
            .mockRejectedValueOnce(new Error('network error'))
            .mockResolvedValueOnce(
                new Response('Bad Gateway', { status: 502 }),
            );

        expect(await getRole(await signToken(oldKey))).toBe('Owner');
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('responds with a 401 when the key set cannot be fetched', async () => {
        fetchMock.mockRejectedValue(new Error('network error'));

        const res = await request(await signToken(oldKey));

        expect(res.status).toBe(401);
        expect(((await res.json()) as { code: string }).code).toBe(
            'JWKS_MISSING',
        );
        expect(fetchMock).toHaveBeenCalledTimes(6);
    });

    it('treats requests without an authorization header as Anonymous', async () => {
        const res = await app.request('/test', { headers: { host: HOST } });

        expect(((await res.json()) as { role: string }).role).toBe('Anonymous');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
