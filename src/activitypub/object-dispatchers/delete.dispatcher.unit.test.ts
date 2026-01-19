import { describe, expect, it } from 'vitest';

import { Delete } from '@fedify/fedify';

import { DeleteDispatcher } from '@/activitypub/object-dispatchers/delete.dispatcher';
import type { FedifyRequestContext } from '@/app';

describe('DeleteDispatcher', () => {
    describe('dispatch', () => {
        it('Should return `null` if it cannot find', async () => {
            const dispatcher = new DeleteDispatcher();

            const ctx = {
                getObjectUri(_type: unknown, data: Record<string, string>) {
                    return new URL(`https://site.com/${data.id}`);
                },
                data: {
                    globaldb: {
                        get() {
                            return null;
                        },
                    },
                },
            } as unknown as FedifyRequestContext;
            const data = {
                id: 'not-found',
            };

            const result = await dispatcher.dispatch(ctx, data);
            expect(result).toBe(null);
        });

        it('Should return a Delete activity if it can find', async () => {
            const dispatcher = new DeleteDispatcher();

            const ctx = {
                getObjectUri(_type: unknown, data: Record<string, string>) {
                    return new URL(`https://site.com/${data.id}`);
                },
                data: {
                    globaldb: {
                        get() {
                            return {
                                cc: 'https://foobar.com/followers/index',
                                id: 'https://foobar.com/delete/123',
                                to: 'as:Public',
                                type: 'Delete',
                                actor: 'https://foobar.com/users/123',
                                object: 'https://foobar.com/note/123',
                                '@context': [
                                    'https://w3id.org/identity/v1',
                                    'https://www.w3.org/ns/activitystreams',
                                ],
                            };
                        },
                    },
                },
            } as unknown as FedifyRequestContext;
            const data = {
                id: 'found',
            };

            const result = await dispatcher.dispatch(ctx, data);
            expect(result instanceof Delete).toBe(true);
        });
    });
});
