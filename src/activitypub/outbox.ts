import type { Activity, KvStore } from '@fedify/fedify';

import { addToList } from '../kv-helpers';

/**
 * ActivityPub outbox collection
 *
 * @template TActivity Type of activity in the outbox
 */
export interface Outbox<TActivity> {
    /**
     * Add an activity to the outbox
     *
     * @param activity Activity to add
     */
    add(activity: TActivity): Promise<void>;
}

/**
 * Outbox implementation using Fedify's KvStore
 */
export class FedifyKvStoreOutbox implements Outbox<Activity> {
    constructor(private readonly db: KvStore) {}

    async add(activity: Activity) {
        if (activity.id === null) {
            throw new Error(
                'Activity can not be added to outbox without an ID',
            );
        }

        await addToList(this.db, ['outbox'], activity.id.href);
    }
}
