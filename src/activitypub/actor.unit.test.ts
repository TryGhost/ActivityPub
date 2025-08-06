import type { Actor } from '@fedify/fedify';
import { describe, expect, it, vi } from 'vitest';
import { FedifyActorResolver } from '@/activitypub/actor';
import type { FedifyRequestContext } from '@/app';

describe('FedifyActorResolver', () => {
    describe('resolveActorByHandle', () => {
        it('should resolve an actor by handle', async () => {
            const handle = 'foo';

            const mockActor = {} as Actor;

            const mockFedifyCtx = {
                getActor: vi.fn().mockImplementation((identifier) => {
                    if (identifier === handle) {
                        return mockActor;
                    }

                    return null;
                }),
            } as unknown as FedifyRequestContext;

            const resolver = new FedifyActorResolver(mockFedifyCtx);

            const result = await resolver.resolveActorByHandle(handle);

            expect(mockFedifyCtx.getActor).toHaveBeenCalledWith(handle);
            expect(result).toBe(mockActor);
        });

        it('should return null if the actor can not be resolved', async () => {
            const handle = 'foo';

            const mockFedifyCtx = {
                getActor: vi.fn().mockImplementation(() => {
                    return null;
                }),
            } as unknown as FedifyRequestContext;

            const resolver = new FedifyActorResolver(mockFedifyCtx);

            const result = await resolver.resolveActorByHandle(handle);

            expect(mockFedifyCtx.getActor).toHaveBeenCalledWith(handle);
            expect(result).toBeNull();
        });
    });
});
