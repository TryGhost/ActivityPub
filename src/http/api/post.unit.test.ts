import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Account } from 'account/account.entity';
import type { AccountService } from 'account/account.service';
import type { AppContext } from 'app';
import { error, ok } from 'core/result';
import { Audience, Post, PostType } from 'post/post.entity';
import type { PostService } from 'post/post.service';
import type { Site } from 'site/site.service';
import { createGetPostHandler } from './post';

describe('Post API', () => {
    let site: Site;
    let account: Account;
    let postService: PostService;
    let accountService: AccountService;

    /**
     * Helper to get a mock AppContext
     *
     * @param postApId The ID of the post to return when req.param('post_ap_id') is called
     */
    function getMockAppContext(postApId: string) {
        return {
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
    }

    /**
     * Helper to create a post
     *
     * @param id The ID of the post
     */
    function createPost(id: number) {
        return new Post(
            id,
            '259e92cb-5ac2-4d62-910f-ddea29b2cf55',
            account,
            PostType.Article,
            Audience.Public,
            `Test Post ${id}`,
            `Test Post ${id} Excerpt`,
            `Test Post ${id} Content`,
            new URL(`https://${site.host}/posts/${id}`),
            new URL(`https://${site.host}/images/post-${id}.jpg`),
            new Date(),
            {
                ghostAuthors: [],
            },
            0,
            0,
            2,
        );
    }

    beforeEach(() => {
        vi.setSystemTime(new Date('2025-03-25T14:00:00Z'));

        site = {
            id: 123,
            host: 'example.com',
            webhook_secret: 'secret',
        };
        account = Account.createFromData({
            id: 456,
            uuid: 'f4ec91bd-56b7-406f-a174-91495df6e6c',
            username: 'foobar',
            name: 'Foo Bar',
            bio: 'Just a foo bar',
            avatarUrl: new URL(`https://${site.host}/avatars/foobar.png`),
            bannerImageUrl: new URL(`https://${site.host}/banners/foobar.png`),
            site,
            apId: new URL(`https://${site.host}/users/456`),
            url: new URL(`https://${site.host}/users/456`),
            apFollowers: new URL(`https://${site.host}/followers/456`),
        });
        postService = {
            getByApId: vi.fn().mockResolvedValue(error('not-a-post')),
            isLikedByAccount: vi.fn().mockResolvedValue(false),
            isRepostedByAccount: vi.fn().mockResolvedValue(false),
        } as unknown as PostService;
        accountService = {} as AccountService;
    });

    it('should return a post', async () => {
        const postId = 789;
        const postApId = `https://${site.host}/posts/${postId}`;

        const ctx = getMockAppContext(postApId);

        postService.getByApId = vi.fn().mockImplementation((_postApId) => {
            if (_postApId.href === postApId) {
                return ok(createPost(postId));
            }

            return error('not-a-post');
        });

        accountService.getDefaultAccountForSite = vi
            .fn()
            .mockImplementation((_site) => ({ id: 987 }));

        const handler = createGetPostHandler(postService, accountService);

        const response = await handler(ctx);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchFileSnapshot(
            './__snapshots__/post.json',
        );
    });

    it('should return a post with authoredByMe set to true if the post is authored by the default account for the site', async () => {
        const postId = 789;
        const postApId = `https://${site.host}/posts/${postId}`;

        const ctx = getMockAppContext(postApId);

        postService.getByApId = vi.fn().mockImplementation((_postApId) => {
            if (_postApId.href === postApId) {
                return ok(createPost(postId));
            }

            return error('not-a-post');
        });

        accountService.getDefaultAccountForSite = vi
            .fn()
            .mockImplementation((_site) => account);

        const handler = createGetPostHandler(postService, accountService);

        const response = await handler(ctx);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchFileSnapshot(
            './__snapshots__/post-authored-by-me.json',
        );
    });

    it('should return a post with likedByMe set to true if the post is liked by the default account for the site', async () => {
        const postId = 789;
        const postApId = `https://${site.host}/posts/${postId}`;

        const ctx = getMockAppContext(postApId);

        postService.getByApId = vi.fn().mockImplementation((_postApId) => {
            if (_postApId.href === postApId) {
                return ok(createPost(postId));
            }

            return error('not-a-post');
        });

        postService.isLikedByAccount = vi
            .fn()
            .mockImplementation((_postId, _accountId) => {
                if (_postId === postId && _accountId === account.id) {
                    return true;
                }
                return false;
            });

        accountService.getDefaultAccountForSite = vi
            .fn()
            .mockImplementation((_site) => account);

        const handler = createGetPostHandler(postService, accountService);

        const response = await handler(ctx);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchFileSnapshot(
            './__snapshots__/post-liked-by-me.json',
        );
    });

    it('should return a post with repostedByMe set to true if the post is reposted by the default account for the site', async () => {
        const postId = 789;
        const postApId = `https://${site.host}/posts/${postId}`;

        const ctx = getMockAppContext(postApId);

        postService.getByApId = vi.fn().mockImplementation((_postApId) => {
            if (_postApId.href === postApId) {
                return ok(createPost(postId));
            }

            return error('not-a-post');
        });

        postService.isRepostedByAccount = vi
            .fn()
            .mockImplementation((_postId, _accountId) => {
                if (_postId === postId && _accountId === account.id) {
                    return true;
                }
                return false;
            });

        accountService.getDefaultAccountForSite = vi
            .fn()
            .mockImplementation((_site) => account);

        const handler = createGetPostHandler(postService, accountService);

        const response = await handler(ctx);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchFileSnapshot(
            './__snapshots__/post-reposted-by-me.json',
        );
    });

    it('should return 400 for invalid post AP ID', async () => {
        const postApId = 'not-a-url';

        const ctx = getMockAppContext(postApId);

        const handler = createGetPostHandler(postService, accountService);
        const response = await handler(ctx);

        expect(response.status).toBe(400);
    });

    it('should return 404 when post is not found', async () => {
        const postId = 789;
        const postApId = `https://${site.host}/posts/${postId}`;

        const ctx = getMockAppContext(postApId);

        postService.getByApId = vi.fn().mockResolvedValue(error('not-a-post'));

        const handler = createGetPostHandler(postService, accountService);
        const response = await handler(ctx);

        expect(response.status).toBe(404);
    });
});
