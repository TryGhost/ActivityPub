import type { Logger } from '@logtape/logtape';
import { describe, expect, it, vi } from 'vitest';

import type { AccountService } from 'account/account.service';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import type { ModerationService } from 'moderation/moderation.service';
import type { ImageStorageService } from 'storage/image-storage.service';
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
            {} as ImageStorageService,
            {} as ModerationService,
            {} as Logger,
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
            {} as ImageStorageService,
            {} as ModerationService,
            {} as Logger,
        );

        const result = await postService.isRepostedByAccount(postId, accountId);

        expect(result).toBe(true);
    });

    it('should get outbox for an account', async () => {
        const accountId = 123;
        const cursor = '0';
        const pageSize = 10;
        const expectedPosts = [
            { id: 1, content: 'Post 1' },
            { id: 2, content: 'Post 2' },
        ];

        const postRepository = {
            getOutboxForAccount: vi.fn().mockResolvedValue(expectedPosts),
        };

        const postService = new PostService(
            postRepository as unknown as KnexPostRepository,
            {} as AccountService,
            {} as FedifyContextFactory,
            {} as ImageStorageService,
            {} as ModerationService,
            {} as Logger,
        );

        const result = await postService.getOutboxForAccount(
            accountId,
            cursor,
            pageSize,
        );

        expect(result).toEqual(expectedPosts);
        expect(postRepository.getOutboxForAccount).toHaveBeenCalledWith(
            accountId,
            cursor,
            pageSize,
        );
    });

    it('should get outbox item count for an account', async () => {
        const accountId = 123;
        const expectedCount = 5;

        const postRepository = {
            getOutboxItemCount: vi.fn().mockResolvedValue(expectedCount),
        };

        const postService = new PostService(
            postRepository as unknown as KnexPostRepository,
            {} as AccountService,
            {} as FedifyContextFactory,
            {} as ImageStorageService,
            {} as ModerationService,
            {} as Logger,
        );

        const result = await postService.getOutboxItemCount(accountId);

        expect(result).toBe(expectedCount);
        expect(postRepository.getOutboxItemCount).toHaveBeenCalledWith(
            accountId,
        );
    });
});
