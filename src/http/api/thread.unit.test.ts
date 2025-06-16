import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Account, AccountEntity } from 'account/account.entity';
import type { AccountService } from 'account/account.service';
import type { AppContext } from 'app';
import { Audience, Post, PostType } from 'post/post.entity';
import type { KnexPostRepository } from 'post/post.repository.knex';
import type { Site } from 'site/site.service';
import { createGetThreadHandler } from './thread';

describe('Thread API', () => {
    let accountService: AccountService;
    let site: Site;
    let account: Account;
    let postRepository: KnexPostRepository;

    beforeEach(() => {
        vi.setSystemTime(new Date('2025-02-27T15:40:00Z'));

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
        postRepository = {} as KnexPostRepository;
    });

    it('should return a thread', async () => {
        const postApId = 'https://example.com/posts/123';

        const ctx = {
            req: {
                param: (key: string) => {
                    if (key === 'post_ap_id') {
                        return postApId;
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

        postRepository.getThreadByApId = vi
            .fn()
            .mockImplementation((_postApId, accountId) => {
                if (_postApId === postApId && accountId === account.id) {
                    return [
                        {
                            post: new Post(
                                123,
                                '259e92cb-5ac2-4d62-910f-ddea29b2cf55',
                                account,
                                PostType.Article,
                                Audience.Public,
                                'Test Post 123',
                                'Test Post 123 Excerpt',
                                null,
                                'Test Post 123 Content',
                                new URL('https://example.com/posts/123'),
                                new URL(
                                    'https://example.com/images/post-123.jpg',
                                ),
                                new Date(),
                                {
                                    ghostAuthors: [],
                                },
                                0,
                                0,
                                2,
                            ),
                            likedByAccount: false,
                            repostedByAccount: false,
                        },
                        {
                            post: new Post(
                                456,
                                '9ac8f7cd-77e8-4abe-b075-e008bd24f3c5',
                                account,
                                PostType.Article,
                                Audience.Public,
                                'Test Post 456 (reply to Test Post 123)',
                                'Test Post 456 Excerpt',
                                null,
                                'Test Post 456 Content',
                                new URL('https://example.com/posts/456'),
                                new URL(
                                    'https://example.com/images/post-456.jpg',
                                ),
                                new Date(),
                                {
                                    ghostAuthors: [],
                                },
                                0,
                                0,
                                0,
                                123,
                                123,
                            ),
                            likedByAccount: true,
                            repostedByAccount: false,
                        },
                        {
                            post: new Post(
                                789,
                                'e2cfad55-6275-46e8-934f-7fee70fa79f5',
                                account,
                                PostType.Article,
                                Audience.Public,
                                'Test Post 789 (reply to Test Post 123)',
                                'Test Post 789 Excerpt',
                                null,
                                'Test Post 789 Content',
                                new URL('https://example.com/posts/789'),
                                new URL(
                                    'https://example.com/images/post-789.jpg',
                                ),
                                new Date(),
                                {
                                    ghostAuthors: [],
                                },
                                0,
                                0,
                                0,
                                123,
                                123,
                            ),
                            likedByAccount: false,
                            repostedByAccount: true,
                        },
                    ];
                }
                return [];
            });

        const handler = createGetThreadHandler(postRepository, accountService);

        const response = await handler(ctx);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchFileSnapshot(
            './__snapshots__/thread.json',
        );
    });
});
