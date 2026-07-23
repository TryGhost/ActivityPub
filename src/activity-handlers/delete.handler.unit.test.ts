import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Delete, Note, Person } from '@fedify/vocab';

import type { AccountService } from '@/account/account.service';
import type { FedifyContext } from '@/app';
import type { PostService } from '@/post/post.service';
import { DeleteHandler } from './delete.handler';

vi.mock('@/db', () => ({
    getRelatedActivities: vi.fn().mockResolvedValue([]),
}));

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

    const actorApId = new URL('https://example.com/users/alice');
    const noteApId = new URL('https://example.com/notes/123');

    const actor = new Person({ id: actorApId, preferredUsername: 'alice' });

    beforeEach(() => {
        mockLogger = {
            debug: vi.fn(),
            error: vi.fn(),
        };

        mockGlobalDb = {
            delete: vi.fn(),
        };

        mockPostService = {
            deleteByApId: vi.fn(),
        } as unknown as PostService;

        mockAccountService = {
            getByApId: vi.fn().mockResolvedValue(null),
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
        const deleteActivity = new Delete({
            actor: actorApId,
            object: noteApId,
        });

        await handler.handle(mockContext, deleteActivity);

        expect(mockLogger.debug).toHaveBeenCalledWith(
            'Missing delete id - exit',
        );
        expect(mockAccountService.getByApId).not.toHaveBeenCalled();
    });

    it('should ignore account deletions (object is the actor itself)', async () => {
        const deleteActivity = new Delete({
            id: new URL('https://example.com/users/alice#delete'),
            actor: actorApId,
            object: actorApId,
        });

        await handler.handle(mockContext, deleteActivity);

        expect(mockLogger.debug).toHaveBeenCalledWith(
            'Delete is an account deletion, exit early',
        );
        expect(mockAccountService.getByApId).not.toHaveBeenCalled();
        expect(mockPostService.deleteByApId).not.toHaveBeenCalled();
    });

    it('should ignore account deletions with an embedded actor object', async () => {
        const deleteActivity = new Delete({
            id: new URL('https://example.com/users/alice#delete'),
            actor: actorApId,
            object: new Person({
                id: actorApId,
                preferredUsername: 'alice',
            }),
        });

        await handler.handle(mockContext, deleteActivity);

        expect(mockLogger.debug).toHaveBeenCalledWith(
            'Delete is an account deletion, exit early',
        );
        expect(mockAccountService.getByApId).not.toHaveBeenCalled();
        expect(mockPostService.deleteByApId).not.toHaveBeenCalled();
    });

    it('should not make any network requests for account deletions', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockRejectedValue(new Error('network disabled in unit tests'));

        try {
            const deleteActivity = new Delete({
                id: new URL('https://example.com/users/alice#delete'),
                actor: actorApId,
                object: actorApId,
            });

            await handler.handle(mockContext, deleteActivity);

            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('should process Delete activities whose object is a post URI', async () => {
        // Our own outgoing Delete activities reference the post by URI only
        const deleteActivity = new Delete({
            id: new URL('https://example.com/deletes/123'),
            actor,
            object: noteApId,
        });

        await handler.handle(mockContext, deleteActivity);

        expect(mockAccountService.getByApId).toHaveBeenCalledWith(actorApId);
    });

    it('should process Delete activities with an embedded post object', async () => {
        const deleteActivity = new Delete({
            id: new URL('https://example.com/deletes/123'),
            actor,
            object: new Note({ id: noteApId }),
        });

        await handler.handle(mockContext, deleteActivity);

        expect(mockAccountService.getByApId).toHaveBeenCalledWith(actorApId);
    });
});
