import type { KvKey, KvStore, KvStoreSetOptions } from '@fedify/fedify';
import type Knex from 'knex';

export class KnexKvStore implements KvStore {
    private constructor(
        private readonly knex: Knex.Knex,
        private readonly table: string,
    ) {}

    static async create(knex: Knex.Knex, table: string) {
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
            expires: null,
        };
        const exists = await this.knex(this.table).where(query).first();
        if (!exists) {
            await this.knex(this.table).insert({
                ...query,
                ...values,
            });
        } else {
            await this.knex(this.table)
                .where(query)
                .update({
                    ...values,
                });
        }
    }

    async delete(key: KvKey) {
        await this.knex(this.table)
            .where({
                key: JSON.stringify(key),
            })
            .del();
    }
}
