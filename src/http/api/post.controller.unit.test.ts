import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Federation } from '@fedify/fedify';

import type { AccountEntity } from '@/account/account.entity';
import type { KnexAccountRepository } from '@/account/account.repository.knex';
import type { AccountService } from '@/account/account.service';
import type { AppContext, ContextData } from '@/app';
import { error, ok } from '@/core/result';
import { PostController } from '@/http/api/post.controller';
import {
    Audience,
    Post,
    PostSummary,
    PostTitle,
    PostType,
} from '@/post/post.entity';
import type { KnexPostRepository } from '@/post/post.repository.knex';
import type { PostService } from '@/post/post.service';
import type { Site } from '@/site/site.service';
import { createTestInternalAccount } from '@/test/account-entity-test-helpers';

describe('Post API', () => {
    let site: Site;
    let account: AccountEntity;
    let postService: PostService;
    let accountService: AccountService;
    let accountRepository: KnexAccountRepository;
    let postRepository: KnexPostRepository;
    let postController: PostController;
    let fedify: Federation<ContextData>;

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
                if (key === 'account') {
                    return account;
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
            PostTitle.parse(`Test Post ${id}`),
            PostSummary.parse(`Test Post ${id} Excerpt`),
            null,
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

    beforeEach(async () => {
        vi.setSystemTime(new Date('2025-03-25T14:00:00Z'));

        site = {
            id: 123,
            host: 'example.com',
            webhook_secret: 'secret',
            ghost_uuid: 'e604ed82-188c-4f55-a5ce-9ebfb4184970',
        };

        account = await createTestInternalAccount(456, {
            host: new URL('http://example.com'),
            username: 'foobar',
            name: 'Foo Bar',
            bio: 'Just a foobar',
            url: null,
            avatarUrl: new URL('http://example.com/avatar/foobar.png'),
            bannerImageUrl: new URL('http://example.com/banner/foobar.png'),
            customFields: null,
        });
        postService = {
            getByApId: vi.fn().mockResolvedValue(error('not-a-post')),
            isLikedByAccount: vi.fn().mockResolvedValue(false),
            isRepostedByAccount: vi.fn().mockResolvedValue(false),
        } as unknown as PostService;
        accountService = {
            checkIfAccountIsFollowing: vi.fn().mockResolvedValue(false),
        } as unknown as AccountService;
        accountRepository = {} as unknown as KnexAccountRepository;
        postRepository = {} as unknown as KnexPostRepository;
        fedify = {} as unknown as Federation<ContextData>;
        postController = new PostController(
            postService,
            accountService,
            accountRepository,
            postRepository,
            fedify,
        );
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

        ctx.get = vi.fn().mockImplementation((key) => {
            if (key === 'account') {
                return { id: 987 };
            }
        });

        const response = await postController.handleGetPost(ctx);

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

        const response = await postController.handleGetPost(ctx);

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

        const response = await postController.handleGetPost(ctx);

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

        const response = await postController.handleGetPost(ctx);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchFileSnapshot(
            './__snapshots__/post-reposted-by-me.json',
        );
    });

    it('should return 400 for invalid post AP ID', async () => {
        const postApId = 'not-a-url';

        const ctx = getMockAppContext(postApId);

        const response = await postController.handleGetPost(ctx);

        expect(response.status).toBe(400);
    });

    it('should return 404 when post is not found', async () => {
        const postId = 789;
        const postApId = `https://${site.host}/posts/${postId}`;

        const ctx = getMockAppContext(postApId);

        postService.getByApId = vi.fn().mockResolvedValue(error('not-a-post'));

        const response = await postController.handleGetPost(ctx);

        expect(response.status).toBe(404);
    });
});
