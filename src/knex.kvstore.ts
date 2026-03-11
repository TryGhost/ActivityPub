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
    private writesSinceLastCleanup = 0;

    private constructor(
        private readonly knex: Knex.Knex,
        private readonly table: string,
        private readonly logging: Logger,
        private readonly cleanupInterval: number,
    ) {}

    static create(
        knex: Knex.Knex,
        table: string,
        logging: Logger,
        cleanupInterval: number = 100,
    ) {
        return new KnexKvStore(knex, table, logging, cleanupInterval);
    }

    private keyToString(key: KvKey): string {
        return JSON.stringify(key);
    }

    async get(key: KvKey) {
        const keyInfo = getKeyInfo(key);
        this.logging.debug(`KnexKvStore: Get key ${key}`, keyInfo);
        const query = {
            key: this.keyToString(key),
        };
        const row = await this.knex(this.table).where(query).first();
        if (!row) {
            return null;
        }
        if (row.expires !== null && row.expires <= new Date()) {
            this.logging.debug(
                `KnexKvStore: Deleting expired key ${key}`,
                keyInfo,
            );
            await this.knex(this.table).where(query).del();
            return null;
        }
        if (Object.hasOwn(row.value, '@@BOOLEAN@@')) {
            return row.value['@@BOOLEAN@@'];
        }
        return row.value;
    }

    async set(key: KvKey, value: unknown, options?: KvStoreSetOptions) {
        this.logging.debug(`KnexKvStore: Set key ${key}`, getKeyInfo(key));
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

        this.writesSinceLastCleanup++;

        if (this.writesSinceLastCleanup >= this.cleanupInterval) {
            this.writesSinceLastCleanup = 0;
            this.logging.debug('KnexKvStore: Running expired row cleanup');

            await this.knex.raw(
                `DELETE FROM ?? WHERE expires IS NOT NULL AND expires <= ? LIMIT 100`,
                [this.table, new Date()],
            );
        }
    }

    async delete(key: KvKey) {
        this.logging.debug(`KnexKvStore: Delete key ${key}`, getKeyInfo(key));
        await this.knex(this.table)
            .where({
                key: this.keyToString(key),
            })
            .del();
    }
}
