import { describe, expect, it, vi } from 'vitest';

import type { AccountService } from 'account/account.service';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import type { KnexPostRepository } from './post.repository.knex';
import { PostService } from './post.service';

describe('PostService', () => {
    it('should be able to check if a post is liked by an account', async () => {
        const postId = 123;
        const accountId = 456;

        const postRepository = {
            isLikedByAccount: vi
                .fn()
                .mockImplementation((_postId, _accountId) => {
                    return _postId === postId && _accountId === accountId;
                }),
        };

        const postService = new PostService(
            postRepository as unknown as KnexPostRepository,
            {} as AccountService,
            {} as FedifyContextFactory,
        );

        const result = await postService.isLikedByAccount(postId, accountId);

        expect(result).toBe(true);
    });

    it('should be able to check if a post is reposted by an account', async () => {
        const postId = 123;
        const accountId = 456;

        const postRepository = {
            isRepostedByAccount: vi
                .fn()
                .mockImplementation((_postId, _accountId) => {
                    return _postId === postId && _accountId === accountId;
                }),
        };

        const postService = new PostService(
            postRepository as unknown as KnexPostRepository,
            {} as AccountService,
            {} as FedifyContextFactory,
        );

        const result = await postService.isRepostedByAccount(postId, accountId);

        expect(result).toBe(true);
    });
});
