import { describe, expect, it, vi } from 'vitest';

import type { Knex } from 'knex';

import type { ModerationService } from '@/moderation/moderation.service';

import { FeedService } from '@/feed/feed.service';

describe('FeedService', () => {
    describe('removeBlockedAccountPostsFromFeed', () => {
        it('should do nothing if the user associated with the feed account does not exist', async () => {
            const mockKnex = {
                where: vi.fn().mockReturnThis(),
                andWhere: vi.fn().mockReturnThis(),
                delete: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                first: vi.fn(),
            };
            const db = () => mockKnex;
            const moderationService = {} as ModerationService;
            const feedService = new FeedService(
                db as unknown as Knex,
                moderationService,
            );

            await feedService.removeBlockedAccountPostsFromFeed(123, 456);

            expect(mockKnex.delete).not.toHaveBeenCalled();
        });
    });

    describe('removeBlockedDomainPostsFromFeed', () => {
        it('should do nothing if the user associated with the feed account does not exist', async () => {
            const mockKnex = {
                where: vi.fn().mockReturnThis(),
                andWhere: vi.fn().mockReturnThis(),
                delete: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                first: vi.fn(),
            };
            const db = () => mockKnex;
            const moderationService = {} as ModerationService;
            const feedService = new FeedService(
                db as unknown as Knex,
                moderationService,
            );

            await feedService.removeBlockedDomainPostsFromFeed(
                123,
                new URL('https://blocked.com'),
            );

            expect(mockKnex.delete).not.toHaveBeenCalled();
        });
    });
});
