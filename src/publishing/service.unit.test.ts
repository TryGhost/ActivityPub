import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    type Activity,
    type Actor,
    Article,
    Create,
    Note as FedifyNote,
    type Object as FedifyObject,
    Person,
} from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';

import type {
    ActivitySender,
    ActorResolver,
    ObjectStore,
    Outbox,
    UriBuilder,
} from '../activitypub';
import { FedifyPublishingService } from './service';
import { type Note, type Post, PostVisibility } from './types';

vi.mock('uuid', () => ({
    // Return a fixed UUID for deterministic testing
    v4: vi.fn().mockReturnValue('cb1e7e92-5560-4ceb-9272-7e9d0e2a7da4'),
}));

vi.mock('@js-temporal/polyfill', async () => {
    const original = await import('@js-temporal/polyfill');

    return {
        Temporal: {
            ...original.Temporal,
            Now: {
                // Return a fixed instant for deterministic testing
                instant: vi
                    .fn()
                    .mockReturnValue(
                        original.Temporal.Instant.from('2025-01-17T10:30:00Z'),
                    ),
            },
        },
    };
});

describe('FedifyPublishingService', () => {
    const HANDLE = 'foo';

    let mockActivitySender: ActivitySender<Activity, Actor>;
    let actor: Actor;
    let mockActorResolver: ActorResolver<Actor>;
    let mockObjectStore: ObjectStore<FedifyObject>;
    let mockUriBuilder: UriBuilder<FedifyObject>;
    let mockOutbox: Outbox<Activity>;

    beforeEach(() => {
        mockActivitySender = {
            sendActivityToActorFollowers: vi.fn().mockResolvedValue(void 0),
        } as ActivitySender<Activity, Actor>;

        actor = new Person({
            id: new URL(`https://example.com/user/${HANDLE}`),
        });

        mockActorResolver = {
            resolveActorByHandle: vi.fn().mockResolvedValue(actor),
        } as ActorResolver<Actor>;

        mockObjectStore = {
            store: vi.fn().mockResolvedValue(void 0),
        } as ObjectStore<FedifyObject>;

        mockUriBuilder = {
            buildObjectUri: vi.fn().mockImplementation((object, id) => {
                return new URL(
                    `https://example.com/${object.name.toLowerCase()}/${id}`,
                );
            }),
            buildFollowersCollectionUri: vi
                .fn()
                .mockImplementation((handle) => {
                    return new URL(
                        `https://example.com/user/${handle}/followers`,
                    );
                }),
        } as UriBuilder<FedifyObject>;

        mockOutbox = {
            add: vi.fn().mockResolvedValue(void 0),
        } as Outbox<Activity>;
    });

    describe('publishPost', () => {
        let post: Post;

        beforeEach(() => {
            const postId = 'post-123';

            post = {
                id: postId,
                title: 'Post title',
                content: 'Post content',
                excerpt: 'Post excerpt',
                featureImageUrl: new URL(
                    `https://example.com/img/${postId}_feature.jpg`,
                ),
                publishedAt: Temporal.Instant.from('2025-01-12T10:30:00.000Z'),
                url: new URL(`https://example.com/post/${postId}`),
                visibility: PostVisibility.Public,
                author: {
                    handle: HANDLE,
                },
                metadata: {
                    ghostAuthors: [],
                },
            };
        });

        it('should throw an error if the actor can not be resolved', async () => {
            vi.mocked(mockActorResolver.resolveActorByHandle).mockResolvedValue(
                null,
            );

            const service = new FedifyPublishingService(
                mockActivitySender,
                mockActorResolver,
                mockObjectStore,
                mockUriBuilder,
            );

            await expect(service.publishPost(post, mockOutbox)).rejects.toThrow(
                `Actor not resolved for handle: ${post.author.handle}`,
            );
        });

        it('should store the created ActivityPub objects', async () => {
            const service = new FedifyPublishingService(
                mockActivitySender,
                mockActorResolver,
                mockObjectStore,
                mockUriBuilder,
            );

            await service.publishPost(post, mockOutbox);

            expect(mockObjectStore.store).toHaveBeenCalledTimes(3);

            const note = vi.mocked(mockObjectStore.store).mock.calls[0][0];
            const article = vi.mocked(mockObjectStore.store).mock.calls[1][0];
            const create = vi.mocked(mockObjectStore.store).mock.calls[2][0];

            expect(note).toBeInstanceOf(FedifyNote);
            expect(article).toBeInstanceOf(Article);
            expect(create).toBeInstanceOf(Create);

            await expect(await create.toJsonLd()).toMatchFileSnapshot(
                './__snapshots__/service/publish-post-create-activity.json',
            );
        });

        it('should add the create activity to the outbox', async () => {
            const service = new FedifyPublishingService(
                mockActivitySender,
                mockActorResolver,
                mockObjectStore,
                mockUriBuilder,
            );

            await service.publishPost(post, mockOutbox);

            expect(mockOutbox.add).toHaveBeenCalledTimes(1);

            const outboxActivity = vi.mocked(mockOutbox.add).mock.calls[0][0];

            expect(outboxActivity).toBeInstanceOf(Create);
        });

        it('should send the create activity to the followers of the actor', async () => {
            const service = new FedifyPublishingService(
                mockActivitySender,
                mockActorResolver,
                mockObjectStore,
                mockUriBuilder,
            );

            await service.publishPost(post, mockOutbox);

            expect(
                mockActivitySender.sendActivityToActorFollowers,
            ).toHaveBeenCalledTimes(1);

            const sentActivity = vi.mocked(
                mockActivitySender.sendActivityToActorFollowers,
            ).mock.calls[0][0];

            expect(sentActivity).toBeInstanceOf(Create);

            expect(
                vi.mocked(mockActivitySender.sendActivityToActorFollowers).mock
                    .calls[0][1],
            ).toBe(actor);
        });

        it('should return the activity JSON-LD', async () => {
            const service = new FedifyPublishingService(
                mockActivitySender,
                mockActorResolver,
                mockObjectStore,
                mockUriBuilder,
            );

            const result = await service.publishPost(post, mockOutbox);

            expect(result).toBeDefined();

            await expect(result).toMatchFileSnapshot(
                './__snapshots__/service/publish-post-publish-result.json',
            );
        });
    });

    describe('publishNote', () => {
        let note: Note;

        beforeEach(() => {
            note = {
                content: 'Note content',
                author: {
                    handle: HANDLE,
                },
            };
        });

        it('should throw an error if the actor can not be resolved', async () => {
            vi.mocked(mockActorResolver.resolveActorByHandle).mockResolvedValue(
                null,
            );

            const service = new FedifyPublishingService(
                mockActivitySender,
                mockActorResolver,
                mockObjectStore,
                mockUriBuilder,
            );

            await expect(service.publishNote(note, mockOutbox)).rejects.toThrow(
                `Actor not resolved for handle: ${note.author.handle}`,
            );
        });

        it('should store the created ActivityPub objects', async () => {
            const service = new FedifyPublishingService(
                mockActivitySender,
                mockActorResolver,
                mockObjectStore,
                mockUriBuilder,
            );

            await service.publishNote(note, mockOutbox);

            expect(mockObjectStore.store).toHaveBeenCalledTimes(2);

            const fedifyNote = vi.mocked(mockObjectStore.store).mock
                .calls[0][0];
            const create = vi.mocked(mockObjectStore.store).mock.calls[1][0];

            expect(fedifyNote).toBeInstanceOf(FedifyNote);
            expect(create).toBeInstanceOf(Create);

            await expect(await create.toJsonLd()).toMatchFileSnapshot(
                './__snapshots__/service/publish-note-create-activity.json',
            );
        });

        it('should add the create activity to the outbox', async () => {
            const service = new FedifyPublishingService(
                mockActivitySender,
                mockActorResolver,
                mockObjectStore,
                mockUriBuilder,
            );

            await service.publishNote(note, mockOutbox);

            expect(mockOutbox.add).toHaveBeenCalledTimes(1);

            const outboxActivity = vi.mocked(mockOutbox.add).mock.calls[0][0];

            expect(outboxActivity).toBeInstanceOf(Create);
        });

        it('should send the create activity to the followers of the actor', async () => {
            const service = new FedifyPublishingService(
                mockActivitySender,
                mockActorResolver,
                mockObjectStore,
                mockUriBuilder,
            );

            await service.publishNote(note, mockOutbox);

            expect(
                mockActivitySender.sendActivityToActorFollowers,
            ).toHaveBeenCalledTimes(1);

            const sentActivity = vi.mocked(
                mockActivitySender.sendActivityToActorFollowers,
            ).mock.calls[0][0];

            expect(sentActivity).toBeInstanceOf(Create);

            expect(
                vi.mocked(mockActivitySender.sendActivityToActorFollowers).mock
                    .calls[0][1],
            ).toBe(actor);
        });

        it('should return the activity JSON-LD', async () => {
            const service = new FedifyPublishingService(
                mockActivitySender,
                mockActorResolver,
                mockObjectStore,
                mockUriBuilder,
            );

            const result = await service.publishNote(note, mockOutbox);

            expect(result).toBeDefined();

            await expect(result).toMatchFileSnapshot(
                './__snapshots__/service/publish-note-publish-result.json',
            );
        });
    });
});
