import { describe, expect, it, vi } from 'vitest';

import type { Activity, KvStore } from '@fedify/fedify';

import * as kvHelpers from '../kv-helpers';

import { FedifyKvStoreOutbox } from './outbox';

vi.mock('../kv-helpers', () => ({
    addToList: vi.fn(),
}));

describe('FedifyKvStoreOutbox', () => {
    describe('add', () => {
        it('should add an activity to the outbox', async () => {
            const mockKvStore = {} as KvStore;
            const mockActivityId = new URL(
                'https://example.com/activity/abc-123',
            );
            const mockActivity = {
                id: mockActivityId,
            } as Activity;

            const outbox = new FedifyKvStoreOutbox(mockKvStore);

            await outbox.add(mockActivity);

            expect(kvHelpers.addToList).toHaveBeenCalledWith(
                mockKvStore,
                ['outbox'],
                mockActivityId.href,
            );
        });

        it('should throw an error if the activity has no ID', async () => {
            const mockKvStore = {} as KvStore;
            const mockActivity = {
                id: null,
            } as Activity;

            const outbox = new FedifyKvStoreOutbox(mockKvStore);

            await expect(outbox.add(mockActivity)).rejects.toThrow(
                'Activity can not be added to outbox without an ID',
            );
        });
    });
});
