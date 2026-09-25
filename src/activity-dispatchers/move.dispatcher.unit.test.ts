import { describe, expect, it, vi } from 'vitest';

import { Move } from '@fedify/vocab';

import { dispatchMoveActivity } from '@/activity-dispatchers/move.dispatcher';
import type { FedifyRequestContext } from '@/app';

describe('dispatchMoveActivity', () => {
    it('retrieves a stored outbound Move by its object URI', async () => {
        const id = new URL('https://example.com/.ghost/activitypub/move/one');
        const source = new URL(
            'https://example.com/.ghost/activitypub/users/index',
        );
        const move = new Move({
            id,
            actor: source,
            object: source,
            target: new URL('https://elsewhere.example/users/new'),
        });
        const ctx = {
            getObjectUri: vi.fn().mockReturnValue(id),
            data: {
                globaldb: {
                    get: vi.fn().mockResolvedValue(await move.toJsonLd()),
                },
            },
        } as unknown as FedifyRequestContext;

        const result = await dispatchMoveActivity(ctx, { id: 'one' });
        expect(result?.id?.href).toBe(id.href);
        expect(result?.targetId?.href).toBe(
            'https://elsewhere.example/users/new',
        );
    });
});
