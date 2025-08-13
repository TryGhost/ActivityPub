import { Buffer } from 'node:buffer';

import type { KvKey, KvStore, KvStoreSetOptions } from '@fedify/fedify';
import type { Cluster, RedisKey } from 'ioredis';

export interface Codec {
    /**
     * Encodes a JavaScript object to binary data.
     * @param value The JavaScript object to encode.
     * @returns The encoded binary data.
     * @throws {EncodingError} If the JavaScript object cannot be encoded.
     */
    encode(value: unknown): Buffer;

    /**
     * Decodes a JavaScript object from binary data.
     * @param encoded The binary data to decode.
     * @returns The decoded JavaScript object.
     * @throws {DecodingError} If the binary data is invalid.
     */
    decode(encoded: Buffer): unknown;
}

/**
 * An error that occurs when encoding or decoding data.
 */
export class CodecError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CodecError';
    }
}

/**
 * An error that occurs when encoding data.
 */
export class EncodingError extends CodecError {
    constructor(message: string) {
        super(message);
        this.name = 'EncodingError';
    }
}

/**
 * An error that occurs when decoding data.
 */
export class DecodingError extends CodecError {
    constructor(message: string) {
        super(message);
        this.name = 'DecodingError';
    }
}

/**
 * A codec that encodes and decodes JavaScript objects to and from JSON.
 */
export class JsonCodec implements Codec {
    #textEncoder = new TextEncoder();
    #textDecoder = new TextDecoder();

    encode(value: unknown): Buffer {
        let json: string;
        try {
            json = JSON.stringify(value);
        } catch (e) {
            if (e instanceof TypeError) throw new EncodingError(e.message);
            throw e;
        }
        return Buffer.from(this.#textEncoder.encode(json));
    }

    decode(encoded: Buffer): unknown {
        const json = this.#textDecoder.decode(encoded);
        try {
            return JSON.parse(json);
        } catch (e) {
            if (e instanceof SyntaxError) throw new DecodingError(e.message);
            throw e;
        }
    }
}

export interface RedisKvStoreOptions {
    /**
     * The prefix to use for all keys in the key–value store in Redis.
     * Defaults to `"fedify::"`.
     */
    keyPrefix?: RedisKey;

    /**
     * The codec to use for encoding and decoding values in the key–value store.
     * Defaults to {@link JsonCodec}.
     */
    codec?: Codec;
}

export class RedisKvStore implements KvStore {
    #redis: Cluster;
    #keyPrefix: RedisKey;
    #codec: Codec;
    #textEncoder = new TextEncoder();

    /**
     * Creates a new Redis key–value store.
     * @param redis The Redis client to use.
     * @param options The options for the key–value store.
     */
    constructor(redis: Cluster, options: RedisKvStoreOptions = {}) {
        this.#redis = redis;
        this.#keyPrefix = options.keyPrefix ?? 'fedify::';
        this.#codec = options.codec ?? new JsonCodec();
    }

    #serializeKey(key: KvKey): RedisKey {
        const suffix = key
            .map((part: string) => part.replaceAll(':', '_:'))
            .join('::');
        if (typeof this.#keyPrefix === 'string') {
            return `${this.#keyPrefix}${suffix}`;
        }
        const suffixBytes = this.#textEncoder.encode(suffix);
        return Buffer.concat([new Uint8Array(this.#keyPrefix), suffixBytes]);
    }

    async get<T = unknown>(key: KvKey): Promise<T | undefined> {
        const serializedKey = this.#serializeKey(key);
        const encodedValue = await this.#redis.getBuffer(serializedKey);
        if (encodedValue == null) return undefined;
        return this.#codec.decode(encodedValue) as T;
    }

    async set(
        key: KvKey,
        value: unknown,
        options?: KvStoreSetOptions | undefined,
    ): Promise<void> {
        const serializedKey = this.#serializeKey(key);
        const encodedValue = this.#codec.encode(value);
        if (options?.ttl != null) {
            await this.#redis.setex(
                serializedKey,
                options.ttl.total('second'),
                encodedValue,
            );
        } else {
            await this.#redis.set(serializedKey, encodedValue);
        }
    }

    async delete(key: KvKey): Promise<void> {
        const serializedKey = this.#serializeKey(key);
        await this.#redis.del(serializedKey);
    }
}
