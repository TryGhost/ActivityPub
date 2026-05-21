import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '@logtape/logtape';

import { AccountFollowedEvent, AccountUnfollowedEvent } from '@/account/events';
import type { NodeInfoService } from '@/activitypub/nodeinfo.service';
import { NodeInfoEventService } from '@/activitypub/nodeinfo-event.service';
import { AsyncEvents } from '@/core/events';
import { PostCreatedEvent } from '@/post/post-created.event';
import { PostDeletedEvent } from '@/post/post-deleted.event';
import { PostDerepostedEvent } from '@/post/post-dereposted.event';
import { PostLikedEvent } from '@/post/post-liked.event';
import { PostRepostedEvent } from '@/post/post-reposted.event';
import { PostUnlikedEvent } from '@/post/post-unliked.event';
import { PostUpdatedEvent } from '@/post/post-updated.event';

describe('NodeInfoEventService', () => {
    const logger = {
        warn: vi.fn(),
    } as unknown as Logger;

    it('marks local post authors active for post lifecycle events', async () => {
        const events = new AsyncEvents();
        const nodeInfoService = {
            markPostAuthorActive: vi.fn(),
            markAccountActive: vi.fn(),
        };
        new NodeInfoEventService(
            events,
            nodeInfoService as unknown as NodeInfoService,
            logger,
        ).init();

        await events.emitAsync(
            PostCreatedEvent.getName(),
            new PostCreatedEvent(1),
        );
        await events.emitAsync(
            PostUpdatedEvent.getName(),
            new PostUpdatedEvent(2),
        );
        await events.emitAsync(
            PostDeletedEvent.getName(),
            new PostDeletedEvent(
                3,
                'https://example.com/post/3',
                4,
                'https://example.com/.ghost/activitypub/users/index',
                'https://example.com/.ghost/activitypub/followers/index',
                'index',
                true,
            ),
        );

        expect(nodeInfoService.markPostAuthorActive).toHaveBeenCalledWith(1);
        expect(nodeInfoService.markPostAuthorActive).toHaveBeenCalledWith(2);
        expect(nodeInfoService.markAccountActive).toHaveBeenCalledWith(4);
    });

    it('marks local actors active for interactions', async () => {
        const events = new AsyncEvents();
        const nodeInfoService = {
            markPostAuthorActive: vi.fn(),
            markAccountActive: vi.fn(),
        };
        new NodeInfoEventService(
            events,
            nodeInfoService as unknown as NodeInfoService,
            logger,
        ).init();

        await events.emitAsync(
            PostLikedEvent.getName(),
            new PostLikedEvent(1, 2, 10),
        );
        await events.emitAsync(
            PostUnlikedEvent.getName(),
            new PostUnlikedEvent(1, 11),
        );
        await events.emitAsync(
            PostRepostedEvent.getName(),
            new PostRepostedEvent(1, 12),
        );
        await events.emitAsync(
            PostDerepostedEvent.getName(),
            new PostDerepostedEvent(1, 13),
        );
        await events.emitAsync(
            AccountFollowedEvent.getName(),
            new AccountFollowedEvent(99, 14),
        );
        await events.emitAsync(
            AccountUnfollowedEvent.getName(),
            new AccountUnfollowedEvent(99, 15),
        );

        expect(nodeInfoService.markAccountActive).toHaveBeenCalledWith(10);
        expect(nodeInfoService.markAccountActive).toHaveBeenCalledWith(11);
        expect(nodeInfoService.markAccountActive).toHaveBeenCalledWith(12);
        expect(nodeInfoService.markAccountActive).toHaveBeenCalledWith(13);
        expect(nodeInfoService.markAccountActive).toHaveBeenCalledWith(14);
        expect(nodeInfoService.markAccountActive).toHaveBeenCalledWith(15);
    });
});
