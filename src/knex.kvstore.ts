import type { KvKey, KvStore, KvStoreSetOptions } from '@fedify/fedify';
import type { Logger } from '@logtape/logtape';
import type Knex from 'knex';

function getKeyInfo(key: KvKey) {
    const isFedifyKey = key[0] === '_fedify';
    return {
        key,
        isFedifyKey,
        keyType: isFedifyKey ? key[1] : key[0],
    };
}

export class KnexKvStore implements KvStore {
    private constructor(
        private readonly knex: Knex.Knex,
        private readonly table: string,
        private readonly logging: Logger,
    ) {}

    static create(knex: Knex.Knex, table: string, logging: Logger) {
        // TODO: Validate table structure
        return new KnexKvStore(knex, table, logging);
    }

    private keyToString(key: KvKey): string {
        return JSON.stringify(key);
    }

    async get(key: KvKey) {
        this.logging.info(`KnexKvStore: Get key ${key}`, getKeyInfo(key));
        const query = {
            key: this.keyToString(key),
        };
        const row = await this.knex(this.table).where(query).first();
        if (!row) {
            return null;
        }
        if (Object.hasOwnProperty.call(row.value, '@@BOOLEAN@@')) {
            return row.value['@@BOOLEAN@@'];
        }
        return row.value;
    }

    async set(key: KvKey, value: unknown, options?: KvStoreSetOptions) {
        this.logging.info(`KnexKvStore: Set key ${key}`, getKeyInfo(key));
        let valueToStore = value;

        if (typeof valueToStore === 'boolean') {
            valueToStore = {
                '@@BOOLEAN@@': valueToStore,
            };
        }
        const query = {
            key: this.keyToString(key),
        };
        const values = {
            value: JSON.stringify(valueToStore),
            expires: options?.ttl
                ? new Date(Date.now() + options.ttl.total('milliseconds'))
                : null,
        };
        await this.knex(this.table)
            .insert({
                ...query,
                ...values,
            })
            .onConflict('key')
            .merge(['value', 'expires']);
    }

    async delete(key: KvKey) {
        this.logging.info(`KnexKvStore: Delete key ${key}`, getKeyInfo(key));
        await this.knex(this.table)
            .where({
                key: this.keyToString(key),
            })
            .del();
    }
}
