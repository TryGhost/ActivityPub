import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    type MockInstance,
    vi,
} from 'vitest';

import {
    generateKeyPairSync,
    type JsonWebKey,
    type KeyObject,
} from 'node:crypto';

import type {
    KvKey,
    KvStore,
    KvStoreListEntry,
    KvStoreSetOptions,
} from '@fedify/fedify';
import type { Logger } from '@logtape/logtape';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

import type { HonoContextVariables } from '@/app';
import { createRoleMiddleware } from '@/http/middleware/role-guard';

type TestKey = {
    kid: string;
    privateKey: KeyObject;
    publicKey: KeyObject;
    jwk: JsonWebKey;
};

function createTestKey(kid: string, modulusLength = 2048): TestKey {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
        modulusLength,
    });

    return {
        kid,
        privateKey,
        publicKey,
        jwk: {
            ...publicKey.export({ format: 'jwk' }),
            kid,
            use: 'sig',
            alg: 'RS256',
        },
    };
}

function signToken(
    key: TestKey,
    {
        kid = key.kid,
        algorithm = 'RS256',
        expiresIn = 300,
    }: {
        kid?: string | null;
        algorithm?: jwt.Algorithm;
        expiresIn?: number | null;
    } = {},
) {
    return jwt.sign({ role: 'Owner' }, key.privateKey, {
        algorithm,
        // jsonwebtoken refuses to sign with keys smaller than 2048 bits
        allowInsecureKeySizes: true,
        ...(kid === null ? {} : { keyid: kid }),
        ...(expiresIn === null ? {} : { expiresIn }),
    });
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
    let servedKeys: JsonWebKey[];
    let fetchMock: MockInstance<typeof fetch>;
    let app: Hono<{ Variables: HonoContextVariables }>;

    let oldKey: TestKey;
    let newKey: TestKey;

    beforeEach(async () => {
        clock = Date.UTC(2026, 0, 1);
        kv = new FakeKvStore(() => clock);

        // Sites that haven't rotated yet sign with a 1024-bit key, and rotate
        // to a 2048-bit key
        oldKey = createTestKey('old-key', 1024);
        newKey = createTestKey('new-key');
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
        expect(await getRole(signToken(oldKey))).toBe('Owner');
        expect(await getRole(signToken(oldKey))).toBe('Owner');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            `http://${HOST}/ghost/.well-known/jwks.json`,
        );
        expect(getFetchHeaders(0).get('cache-control')).toBeNull();
    });

    it('verifies tokens signed by both 1024-bit and 2048-bit keys', async () => {
        servedKeys = [oldKey.jwk, newKey.jwk];

        expect(oldKey.publicKey.asymmetricKeyDetails?.modulusLength).toBe(1024);
        expect(newKey.publicKey.asymmetricKeyDetails?.modulusLength).toBe(2048);

        expect(await getRole(signToken(oldKey))).toBe('Owner');
        expect(await getRole(signToken(newKey))).toBe('Owner');
    });

    it('verifies a token signed by a key that is not first in the key set', async () => {
        servedKeys = [oldKey.jwk, newKey.jwk];

        expect(await getRole(signToken(newKey))).toBe('Owner');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('refetches the key set when the token is signed by a key missing from the cache', async () => {
        expect(await getRole(signToken(oldKey))).toBe('Owner');

        // Ghost publishes the new key and starts signing with it
        servedKeys = [newKey.jwk, oldKey.jwk];

        expect(await getRole(signToken(newKey))).toBe('Owner');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(getFetchHeaders(1).get('cache-control')).toBe('no-cache');

        // The refetched key set is cached
        expect(await getRole(signToken(newKey))).toBe('Owner');
        expect(await getRole(signToken(oldKey))).toBe('Owner');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('rejects a token whose key is still missing after refetching', async () => {
        const unknownKey = createTestKey('unknown-key');

        expect(await getRole(signToken(unknownKey))).toBe('Anonymous');
        // Initial fetch, then a single refetch for the unknown key
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not refetch for an unknown key within the cooldown', async () => {
        const unknownKey = createTestKey('unknown-key');
        expect(await getRole(signToken(oldKey))).toBe('Owner');

        expect(await getRole(signToken(unknownKey))).toBe('Anonymous');
        expect(fetchMock).toHaveBeenCalledTimes(2);

        clock += REFETCH_COOLDOWN_MS - 1;
        servedKeys = [unknownKey.jwk];

        expect(await getRole(signToken(unknownKey))).toBe('Anonymous');
        expect(fetchMock).toHaveBeenCalledTimes(2);

        clock += 1;

        expect(await getRole(signToken(unknownKey))).toBe('Owner');
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('tries every key for a token without a kid', async () => {
        servedKeys = [oldKey.jwk, newKey.jwk];

        expect(await getRole(signToken(newKey, { kid: null }))).toBe('Owner');
        expect(await getRole(signToken(oldKey, { kid: null }))).toBe('Owner');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects a token without a kid that no key verifies, without refetching', async () => {
        const unknownKey = createTestKey('unknown-key');

        expect(await getRole(signToken(unknownKey, { kid: null }))).toBe(
            'Anonymous',
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('refetches the key set once the cached copy has expired', async () => {
        expect(await getRole(signToken(oldKey))).toBe('Owner');

        clock += KEY_SET_TTL.total('milliseconds') - 1;
        expect(await getRole(signToken(oldKey))).toBe('Owner');
        expect(fetchMock).toHaveBeenCalledTimes(1);

        clock += 1;
        expect(await getRole(signToken(oldKey))).toBe('Owner');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(getFetchHeaders(1).get('cache-control')).toBeNull();
    });

    it('rejects a token signed with an algorithm other than RS256, without refetching', async () => {
        const rs512Token = signToken(oldKey, { algorithm: 'RS512' });

        // Algorithm confusion: an HMAC token keyed with the public key
        const hs256Token = jwt.sign(
            { role: 'Owner' },
            oldKey.publicKey.export({ type: 'spki', format: 'pem' }),
            { algorithm: 'HS256', keyid: oldKey.kid, expiresIn: 300 },
        );

        expect(await getRole(rs512Token)).toBe('Anonymous');
        expect(await getRole(hs256Token)).toBe('Anonymous');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects a token with a bad signature for a known kid, without refetching', async () => {
        // Signed by a different key but claiming to be the old key
        const token = signToken(newKey, { kid: oldKey.kid });

        expect(await getRole(token)).toBe('Anonymous');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects an expired token', async () => {
        const token = signToken(oldKey, { expiresIn: -60 });

        expect(await getRole(token)).toBe('Anonymous');
    });

    it('rejects a token without an expiry', async () => {
        const token = signToken(oldKey, { expiresIn: null });

        expect(await getRole(token)).toBe('Anonymous');
    });

    it('retries fetching the key set when the fetch fails', async () => {
        fetchMock
            .mockRejectedValueOnce(new Error('network error'))
            .mockResolvedValueOnce(
                new Response('Bad Gateway', { status: 502 }),
            );

        expect(await getRole(signToken(oldKey))).toBe('Owner');
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('responds with a 401 when the key set cannot be fetched', async () => {
        fetchMock.mockRejectedValue(new Error('network error'));

        const res = await request(signToken(oldKey));

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
