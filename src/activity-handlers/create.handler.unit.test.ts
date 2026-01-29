import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Create, PUBLIC_COLLECTION } from '@fedify/fedify';

import type { FedifyContext } from '@/app';
import { ok } from '@/core/result';
import {
    Audience,
    Post,
    PostSummary,
    PostTitle,
    PostType,
} from '@/post/post.entity';
import type { PostService } from '@/post/post.service';
import { createTestExternalAccount } from '@/test/account-entity-test-helpers';
import { CreateHandler } from './create.handler';

describe('CreateHandler', () => {
    let handler: CreateHandler;
    let mockPostService: PostService;
    let mockContext: FedifyContext;
    let mockLogger: {
        info: ReturnType<typeof vi.fn>;
        debug: ReturnType<typeof vi.fn>;
        error: ReturnType<typeof vi.fn>;
    };
    let mockGlobalDb: {
        get: ReturnType<typeof vi.fn>;
        set: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
        };

        mockGlobalDb = {
            get: vi.fn(),
            set: vi.fn(),
        };

        mockPostService = {
            getByApId: vi.fn(),
        } as unknown as PostService;

        mockContext = {
            data: {
                logger: mockLogger,
                globaldb: mockGlobalDb,
            },
            parseUri: vi.fn((url) => ({ type: 'object', id: url?.href })),
        } as unknown as FedifyContext;

        handler = new CreateHandler(mockPostService);
    });

    describe('handle', () => {
        it('should ignore Create activities with no id', async () => {
            const mockCreate = {
                id: null,
                objectId: new URL('https://example.com/post/123'),
                toIds: [PUBLIC_COLLECTION],
                ccIds: [],
                toJsonLd: vi.fn(),
            } as unknown as Create;

            await handler.handle(mockContext, mockCreate);

            expect(mockPostService.getByApId).not.toHaveBeenCalled();
            expect(mockGlobalDb.set).not.toHaveBeenCalled();
        });

        it('should ignore Create activities with no objectId', async () => {
            const mockCreate = {
                id: new URL('https://example.com/create/123'),
                objectId: null,
                toIds: [PUBLIC_COLLECTION],
                ccIds: [],
                toJsonLd: vi.fn(),
            } as unknown as Create;

            await handler.handle(mockContext, mockCreate);

            expect(mockPostService.getByApId).not.toHaveBeenCalled();
            expect(mockGlobalDb.set).not.toHaveBeenCalled();
        });

        it('should ignore private / unlisted Create activities', async () => {
            const mockCreate = {
                id: new URL('https://example.com/create/123'),
                objectId: new URL('https://example.com/post/123'),
                toIds: [new URL('https://example.com/users/specific-user')], // Not addressed to PUBLIC_COLLECTION
                ccIds: [],
                toJsonLd: vi.fn(),
            } as unknown as Create;

            await handler.handle(mockContext, mockCreate);

            expect(mockPostService.getByApId).not.toHaveBeenCalled();
            expect(mockGlobalDb.set).not.toHaveBeenCalled();
        });

        it('should process Create activity', async () => {
            const mockAccount = await createTestExternalAccount(1, {
                username: 'testuser',
                name: 'Test User',
                bio: null,
                url: null,
                avatarUrl: null,
                bannerImageUrl: null,
                customFields: null,
                apId: new URL('https://example.com/users/testuser'),
                apFollowers: null,
                apInbox: new URL('https://example.com/users/testuser/inbox'),
            });

            const postApId = new URL('https://example.com/post/123');
            const mockPost = new Post(
                1,
                'post-uuid',
                mockAccount,
                PostType.Article,
                Audience.Public,
                PostTitle.parse('Test Post'),
                PostSummary.parse('Test excerpt'),
                null,
                'Test content',
                postApId,
                null,
                new Date(),
                { ghostAuthors: [] },
                0,
                0,
                0,
                null, // inReplyTo
                null, // threadRoot
                null, // _readingTimeMinutes
                [], // attachments
                postApId, // apId
            );

            vi.mocked(mockPostService.getByApId).mockResolvedValue(
                ok(mockPost),
            );

            const mockCreateJson = {
                '@context': 'https://www.w3.org/ns/activitystreams',
                type: 'Create',
                id: 'https://example.com/create/123',
            };

            const mockCreate = {
                id: new URL('https://example.com/create/123'),
                objectId: new URL('https://example.com/post/123'),
                toIds: [PUBLIC_COLLECTION],
                ccIds: [],
                toJsonLd: vi.fn().mockResolvedValue(mockCreateJson),
            } as unknown as Create;

            await handler.handle(mockContext, mockCreate);

            expect(mockPostService.getByApId).toHaveBeenCalledWith(
                mockCreate.objectId,
            );
            expect(mockGlobalDb.set).toHaveBeenCalledWith(
                [mockCreate.id?.href],
                mockCreateJson,
            );
        });
    });
});
