import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountEntity } from 'account/account.entity';
import type { AccountService } from 'account/account.service';
import type { AppContext } from 'app';
import type { FeedService } from 'feed/feed.service';
import { PostType } from 'post/post.entity';
import type { Site } from 'site/site.service';
import { createGetFeedHandler } from './feed';

describe('Feed API', () => {
    let feedService: FeedService;
    let accountService: AccountService;
    let site: Site;
    let account: AccountEntity;

    beforeEach(() => {
        vi.setSystemTime(new Date('2025-02-24T16:40:00Z'));

        site = {
            id: 123,
            host: 'example.com',
            webhook_secret: 'secret',
        };
        const draft = AccountEntity.draft({
            isInternal: true,
            host: new URL('http://example.com'),
            username: 'foobar',
            name: 'Foo Bar',
            bio: 'Just a foobar',
            url: null,
            avatarUrl: new URL('http://example.com/avatar/foobar.png'),
            bannerImageUrl: new URL('http://example.com/banner/foobar.png'),
        });
        account = AccountEntity.create({
            id: 456,
            ...draft,
        });
        accountService = {
            getDefaultAccountForSite: async (_site: Site) => {
                if (_site === site) {
                    return account;
                }

                return null;
            },
        } as unknown as AccountService;
        feedService = {} as FeedService;
    });

    describe('retrieving a feed', () => {
        it('should return a list of posts', async () => {
            const ctx = {
                req: {
                    query: (key: string) => {
                        if (key === 'next') {
                            return null;
                        }
                        if (key === 'limit') {
                            return '2';
                        }
                        return null;
                    },
                },
                get: (key: string) => {
                    if (key === 'site') {
                        return site;
                    }
                },
            } as unknown as AppContext;

            const handler = createGetFeedHandler(
                feedService,
                accountService,
                'Inbox',
            );

            feedService.getFeedData = vi.fn().mockImplementation((options) => {
                if (
                    options.accountId === account.id &&
                    options.feedType === 'Inbox' &&
                    options.limit === 2 &&
                    options.cursor === null
                ) {
                    return {
                        results: [
                            {
                                post_id: 789,
                                post_type: PostType.Article,
                                post_title: 'Post 789',
                                post_excerpt: 'Excerpt 789',
                                post_content: 'Content 789',
                                post_url: 'https://example.com/post-789',
                                post_image_url:
                                    'https://example.com/images/post-789.png',
                                post_published_at: new Date(),
                                post_like_count: 1,
                                post_liked_by_user: 0,
                                post_reply_count: 2,
                                post_reading_time_minutes: 3,
                                post_repost_count: 4,
                                post_reposted_by_user: 0,
                                post_ap_id:
                                    'https://example.com/.activitypub/post/post-789',
                                author_id: 987,
                                author_name: 'Foo Bar',
                                author_username: 'foobar',
                                author_url: 'https://example.com/foobar',
                                reposter_id: null,
                                reposter_name: null,
                                reposter_username: null,
                                reposter_url: null,
                                reposter_avatar_url: null,
                                post_attachments: [
                                    {
                                        type: 'Image',
                                        mediaType: 'image/jpeg',
                                        name: 'test.jpg',
                                        url: 'https://example.com/test.jpg',
                                    },
                                    {
                                        type: 'Image',
                                        mediaType: 'image/jpeg',
                                        name: 'test1.jpg',
                                        url: 'https://example.com/test1.jpg',
                                    },
                                ],
                            },
                            {
                                post_id: 790,
                                post_type: PostType.Article,
                                post_title: 'Post 790',
                                post_excerpt: 'Excerpt 790',
                                post_content: 'Content 790',
                                post_url: 'https://example.com/post-790',
                                post_image_url:
                                    'https://example.com/images/post-790.png',
                                post_published_at: new Date(),
                                post_like_count: 0,
                                post_liked_by_user: 0,
                                post_reply_count: 1,
                                post_reading_time_minutes: 2,
                                post_repost_count: 3,
                                post_reposted_by_user: 1,
                                post_ap_id:
                                    'https://example.com/.activitypub/post/post-790',
                                author_id: 987,
                                author_name: 'Foo Bar',
                                author_username: 'foobar',
                                author_url: 'https://example.com/foobar',
                                reposter_id: 654,
                                reposter_name: 'Baz Qux',
                                reposter_username: 'bazqux',
                                reposter_url: 'https://example.com/bazqux',
                                reposter_avatar_url:
                                    'https://example.com/images/bazqux.png',
                                post_attachments: [],
                            },
                        ],
                        nextCursor: null,
                    };
                }

                return {
                    results: [],
                    nextCursor: null,
                };
            });

            const response = await handler(ctx);

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toMatchFileSnapshot(
                './__snapshots__/feed.json',
            );
        });
    });
});
