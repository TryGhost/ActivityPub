import type { KvKey, KvStore, KvStoreSetOptions } from '@fedify/fedify';
import type Knex from 'knex';

export interface KnexKvStoreOptions {
    filterActivityIdempotenceOrigin?: boolean;
}

export class KnexKvStore implements KvStore {
    private constructor(
        private readonly knex: Knex.Knex,
        private readonly table: string,
        private readonly options: KnexKvStoreOptions = {},
    ) {}

    static create(
        knex: Knex.Knex,
        table: string,
        options: KnexKvStoreOptions = {},
    ) {
        // TODO: Validate table structure
        return new KnexKvStore(knex, table, options);
    }

    private filterKey(key: KvKey): KvKey {
        if (!this.options.filterActivityIdempotenceOrigin) {
            return key;
        }
        if (
            key.length !== 4 ||
            key[0] !== '_fedify' ||
            key[1] !== 'activityIdempotence'
        ) {
            return key;
        }

        // Remove the origin (3rd element) from the key
        // Format: ["_fedify", "activityIdempotence", origin, activityUrl]
        // Becomes: ["_fedify", "activityIdempotence", activityUrl]
        return [key[0], key[1], key[3]];
    }

    private keyToString(key: KvKey): string {
        const filteredKey = this.filterKey(key);
        return JSON.stringify(filteredKey);
    }

    async get(key: KvKey) {
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
        await this.knex(this.table)
            .where({
                key: this.keyToString(key),
            })
            .del();
    }
}
