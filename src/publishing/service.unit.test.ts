import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    type Activity,
    type Actor,
    Article,
    Create,
    type Object as FedifyObject,
    Note,
    Person,
} from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import type { Logger } from '@logtape/logtape';

import type {
    ActivitySender,
    ActorResolver,
    ObjectStore,
    Outbox,
    UriBuilder,
} from '../activitypub';
import {
    FedifyPublishingService,
    POST_CONTENT_NON_PUBLIC_MARKER,
} from './service';
import { type Post, PostVisibility } from './types';

vi.mock('uuid', () => ({
    // Return a fixed UUID for deterministic testing
    v4: vi.fn().mockReturnValue('cb1e7e92-5560-4ceb-9272-7e9d0e2a7da4'),
}));

describe('FedifyPublishingService', () => {
    describe('publishPost', () => {
        let mockActivitySender: ActivitySender<Activity, Actor>;
        let actor: Actor;
        let mockActorResolver: ActorResolver<Actor>;
        let mockLogger: Logger;
        let mockObjectStore: ObjectStore<FedifyObject>;
        let mockUriBuilder: UriBuilder<FedifyObject>;
        let mockOutbox: Outbox<Activity>;
        let post: Post;

        beforeEach(() => {
            const handle = 'foo';
            mockActivitySender = {
                sendActivityToActorFollowers: vi.fn().mockResolvedValue(void 0),
            } as ActivitySender<Activity, Actor>;

            actor = new Person({
                id: new URL(`https://example.com/user/${handle}`),
            });

            mockActorResolver = {
                resolveActorByHandle: vi.fn().mockResolvedValue(actor),
            } as ActorResolver<Actor>;

            mockLogger = {
                info: vi.fn().mockResolvedValue(void 0),
            } as unknown as Logger;

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
                    handle,
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
                mockLogger,
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
                mockLogger,
                mockObjectStore,
                mockUriBuilder,
            );

            await service.publishPost(post, mockOutbox);

            expect(mockObjectStore.store).toHaveBeenCalledTimes(3);

            const note = vi.mocked(mockObjectStore.store).mock.calls[0][0];
            const article = vi.mocked(mockObjectStore.store).mock.calls[1][0];
            const create = vi.mocked(mockObjectStore.store).mock.calls[2][0];

            expect(note).toBeInstanceOf(Note);
            expect(article).toBeInstanceOf(Article);
            expect(create).toBeInstanceOf(Create);

            await expect(await create.toJsonLd()).toMatchFileSnapshot(
                './__snapshots__/service/create.json',
            );
        });

        it('should add the create activity to the outbox', async () => {
            const service = new FedifyPublishingService(
                mockActivitySender,
                mockActorResolver,
                mockLogger,
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
                mockLogger,
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

        it('should ensure that non-public content is not included in the article content', async () => {
            post.visibility = PostVisibility.Members;
            post.content = `Public content${POST_CONTENT_NON_PUBLIC_MARKER}Non public content`;

            const service = new FedifyPublishingService(
                mockActivitySender,
                mockActorResolver,
                mockLogger,
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

            expect((await sentActivity.getObject())?.content).toBe(
                'Public content',
            );
        });

        it('should not publish a post if there is no public content', async () => {
            post.visibility = PostVisibility.Members;
            post.content = 'Non public content';

            const service = new FedifyPublishingService(
                mockActivitySender,
                mockActorResolver,
                mockLogger,
                mockObjectStore,
                mockUriBuilder,
            );

            await service.publishPost(post, mockOutbox);

            expect(
                mockActivitySender.sendActivityToActorFollowers,
            ).not.toHaveBeenCalled();
        });

        it('should not publish a post if there is no public content prior to the non-public content marker', async () => {
            post.visibility = PostVisibility.Members;
            post.content = `${POST_CONTENT_NON_PUBLIC_MARKER}Non public content`;

            const service = new FedifyPublishingService(
                mockActivitySender,
                mockActorResolver,
                mockLogger,
                mockObjectStore,
                mockUriBuilder,
            );

            await service.publishPost(post, mockOutbox);

            expect(
                mockActivitySender.sendActivityToActorFollowers,
            ).not.toHaveBeenCalled();
        });
    });
});
