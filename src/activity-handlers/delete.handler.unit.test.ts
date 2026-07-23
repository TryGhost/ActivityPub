import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Delete } from '@fedify/vocab';

import type { AccountService } from '@/account/account.service';
import type { FedifyContext } from '@/app';
import { error, ok } from '@/core/result';
import type { PostService } from '@/post/post.service';
import { createTestExternalAccount } from '@/test/account-entity-test-helpers';
import { DeleteHandler } from './delete.handler';

vi.mock('@/db', () => ({
    getRelatedActivities: vi.fn().mockResolvedValue([]),
}));

import { getRelatedActivities } from '@/db';

describe('DeleteHandler', () => {
    let handler: DeleteHandler;
    let mockPostService: PostService;
    let mockAccountService: AccountService;
    let mockContext: FedifyContext;
    let mockLogger: {
        debug: ReturnType<typeof vi.fn>;
        error: ReturnType<typeof vi.fn>;
    };
    let mockGlobalDb: {
        delete: ReturnType<typeof vi.fn>;
    };

    const senderApId = new URL('https://example.com/users/alice');
    const objectApId = new URL('https://example.com/posts/123');

    function createMockDelete(overrides: Partial<Delete> = {}): Delete {
        return {
            id: new URL('https://example.com/deletes/123'),
            actorId: senderApId,
            objectId: objectApId,
            ...overrides,
        } as unknown as Delete;
    }

    beforeEach(() => {
        vi.mocked(getRelatedActivities).mockResolvedValue([]);

        mockLogger = {
            debug: vi.fn(),
            error: vi.fn(),
        };

        mockGlobalDb = {
            delete: vi.fn(),
        };

        mockPostService = {
            deleteByApId: vi.fn().mockResolvedValue(ok(true)),
        } as unknown as PostService;

        mockAccountService = {
            getStoredByApId: vi.fn().mockResolvedValue(null),
        } as unknown as AccountService;

        mockContext = {
            data: {
                logger: mockLogger,
                globaldb: mockGlobalDb,
            },
            parseUri: vi.fn((url) => ({ type: 'object', id: url?.href })),
        } as unknown as FedifyContext;

        handler = new DeleteHandler(mockPostService, mockAccountService);
    });

    it('should ignore Delete activities with no id', async () => {
        await handler.handle(mockContext, createMockDelete({ id: null }));

        expect(mockAccountService.getStoredByApId).not.toHaveBeenCalled();
        expect(mockPostService.deleteByApId).not.toHaveBeenCalled();
    });

    it('should ignore Delete activities with no actor', async () => {
        await handler.handle(mockContext, createMockDelete({ actorId: null }));

        expect(mockAccountService.getStoredByApId).not.toHaveBeenCalled();
        expect(mockPostService.deleteByApId).not.toHaveBeenCalled();
    });

    it('should ignore Delete activities with no object id', async () => {
        await handler.handle(mockContext, createMockDelete({ objectId: null }));

        expect(mockAccountService.getStoredByApId).not.toHaveBeenCalled();
        expect(mockPostService.deleteByApId).not.toHaveBeenCalled();
    });

    it('should drop Delete activities from senders we have not stored', async () => {
        vi.mocked(mockAccountService.getStoredByApId).mockResolvedValue(null);

        await handler.handle(mockContext, createMockDelete());

        expect(mockAccountService.getStoredByApId).toHaveBeenCalledWith(
            senderApId,
        );
        expect(mockPostService.deleteByApId).not.toHaveBeenCalled();
        expect(mockGlobalDb.delete).not.toHaveBeenCalled();
    });

    it('should exit early if looking up the sender fails', async () => {
        vi.mocked(mockAccountService.getStoredByApId).mockRejectedValue(
            new Error('db down'),
        );

        await handler.handle(mockContext, createMockDelete());

        expect(mockPostService.deleteByApId).not.toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalledWith(
            'Error fetching sender account',
            { error: new Error('db down') },
        );
    });

    it('should delete the post when the sender is a stored account', async () => {
        const senderAccount = await createTestExternalAccount(456, {
            username: 'alice',
            name: 'Alice',
            bio: null,
            url: null,
            avatarUrl: null,
            bannerImageUrl: null,
            customFields: null,
            apId: senderApId,
            apFollowers: null,
            apInbox: new URL('https://example.com/users/alice/inbox'),
        });
        vi.mocked(mockAccountService.getStoredByApId).mockResolvedValue(
            senderAccount,
        );

        await handler.handle(mockContext, createMockDelete());

        expect(mockPostService.deleteByApId).toHaveBeenCalledWith(
            objectApId,
            senderAccount,
        );
    });

    it('should remove related activities after a successful delete', async () => {
        const senderAccount = await createTestExternalAccount(456, {
            username: 'alice',
            name: 'Alice',
            bio: null,
            url: null,
            avatarUrl: null,
            bannerImageUrl: null,
            customFields: null,
            apId: senderApId,
            apFollowers: null,
            apInbox: new URL('https://example.com/users/alice/inbox'),
        });
        vi.mocked(mockAccountService.getStoredByApId).mockResolvedValue(
            senderAccount,
        );
        vi.mocked(getRelatedActivities).mockResolvedValue([
            { id: 'activity-1' },
            { id: 'activity-2' },
        ]);

        await handler.handle(mockContext, createMockDelete());

        expect(getRelatedActivities).toHaveBeenCalledWith(objectApId.href);
        expect(mockGlobalDb.delete).toHaveBeenCalledWith(['activity-1']);
        expect(mockGlobalDb.delete).toHaveBeenCalledWith(['activity-2']);
    });

    it('should not remove related activities when the delete fails', async () => {
        const senderAccount = await createTestExternalAccount(456, {
            username: 'alice',
            name: 'Alice',
            bio: null,
            url: null,
            avatarUrl: null,
            bannerImageUrl: null,
            customFields: null,
            apId: senderApId,
            apFollowers: null,
            apInbox: new URL('https://example.com/users/alice/inbox'),
        });
        vi.mocked(mockAccountService.getStoredByApId).mockResolvedValue(
            senderAccount,
        );
        vi.mocked(mockPostService.deleteByApId).mockResolvedValue(
            error('not-author'),
        );

        await handler.handle(mockContext, createMockDelete());

        expect(mockGlobalDb.delete).not.toHaveBeenCalled();
    });
});
