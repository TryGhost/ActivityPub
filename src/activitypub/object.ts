import type { Object as FedifyObject, KvStore } from '@fedify/fedify';

/**
 * Stores ActivityPub objects
 *
 * @template TObject Type of the object to store
 */
export interface ObjectStore<TObject> {
    /**
     * Store an ActivityPub object
     *
     * @param object Object to store
     */
    store(object: TObject): Promise<void>;
}

/**
 * ObjectStore implementation using Fedify's KvStore
 */
export class FedifyKvStoreObjectStore implements ObjectStore<FedifyObject> {
    constructor(private readonly db: KvStore) {}

    async store(object: FedifyObject) {
        if (object.id === null) {
            throw new Error('Object can not be stored without an ID');
        }

        await this.db.set([object.id.href], await object.toJsonLd());
    }
}
