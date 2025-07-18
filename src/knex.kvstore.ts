import type { KvKey, KvStore, KvStoreSetOptions } from '@fedify/fedify';
import type Knex from 'knex';

export class KnexKvStore implements KvStore {
    private constructor(
        private readonly knex: Knex.Knex,
        private readonly table: string,
    ) {}

    static create(knex: Knex.Knex, table: string) {
        // TODO: Validate table structure
        return new KnexKvStore(knex, table);
    }

    async get(key: KvKey) {
        const query = {
            key: JSON.stringify(key),
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
            key: JSON.stringify(key),
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
                key: JSON.stringify(key),
            })
            .del();
    }
}
