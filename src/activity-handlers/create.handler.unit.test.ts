import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Context, type Create, PUBLIC_COLLECTION } from '@fedify/fedify';

import type { ContextData } from '@/app';
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
    let mockContext: Context<ContextData>;
    let mockLogger: {
        info: ReturnType<typeof vi.fn>;
        error: ReturnType<typeof vi.fn>;
    };
    let mockGlobalDb: {
        get: ReturnType<typeof vi.fn>;
        set: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
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
        } as unknown as Context<ContextData>;

        handler = new CreateHandler(mockPostService);
    });

    describe('handle', () => {
        it('should exit early when Create activity has no id', async () => {
            const mockCreate = {
                id: null,
                objectId: new URL('https://example.com/post/123'),
                toIds: [PUBLIC_COLLECTION],
                ccIds: [],
                toJsonLd: vi.fn(),
            } as unknown as Create;

            await handler.handle(mockContext, mockCreate);

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Create missing id - exit',
            );
            expect(mockPostService.getByApId).not.toHaveBeenCalled();
            expect(mockGlobalDb.set).not.toHaveBeenCalled();
        });

        it('should exit early when Create activity has no objectId', async () => {
            const mockCreate = {
                id: new URL('https://example.com/create/123'),
                objectId: null,
                toIds: [PUBLIC_COLLECTION],
                ccIds: [],
                toJsonLd: vi.fn(),
            } as unknown as Create;

            await handler.handle(mockContext, mockCreate);

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Create object id missing, exit early',
            );
            expect(mockPostService.getByApId).not.toHaveBeenCalled();
            expect(mockGlobalDb.set).not.toHaveBeenCalled();
        });

        it('should exit early when Create activity is not public (no PUBLIC_COLLECTION in to: nor cc:)', async () => {
            const mockCreate = {
                id: new URL('https://example.com/create/123'),
                objectId: new URL('https://example.com/post/123'),
                toIds: [new URL('https://example.com/users/specific-user')],
                ccIds: [],
                toJsonLd: vi.fn(),
            } as unknown as Create;

            await handler.handle(mockContext, mockCreate);

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Create activity is not public - exit',
            );
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

            expect(mockLogger.info).toHaveBeenCalledWith('Handling Create');
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
