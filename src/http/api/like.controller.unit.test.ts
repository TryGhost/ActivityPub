import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    type Object as APObject,
    type Federation,
    Like,
    Undo,
} from '@fedify/fedify';

import type { Account } from '@/account/account.entity';
import type { AppContext, ContextData, FedifyContext } from '@/app';
import { error, ok } from '@/core/result';
import { LikeController } from '@/http/api/like.controller';
import * as lookupHelpers from '@/lookup-helpers';
import type { KnexPostRepository } from '@/post/post.repository.knex';
import type { PostService } from '@/post/post.service';
import { createTestInternalAccount } from '@/test/account-entity-test-helpers';

vi.mock('@fedify/fedify', async () => {
    const original = await vi.importActual('@fedify/fedify');

    class MockLike {
        id: URL | null;
        actor: unknown;
        object: unknown;

        constructor({
            id,
            actor,
            object,
        }: { id: URL | null; actor: unknown; object: unknown }) {
            this.id = id;
            this.actor = actor;
            this.object = object;
        }

        async toJsonLd() {
            return {
                type: 'Like',
                id: this.id?.href,
                actor: this.actor,
                object: this.object,
            };
        }

        static async fromJsonLd(json: unknown) {
            return json;
        }
    }

    class MockUndo {
        id: URL | null;
        actor: unknown;
        object: unknown;

        constructor({
            id,
            actor,
            object,
        }: { id: URL | null; actor: unknown; object: unknown }) {
            this.id = id;
            this.actor = actor;
            this.object = object;
        }

        async toJsonLd() {
            return {
                type: 'Undo',
                id: this.id?.href,
                actor: this.actor,
                object: this.object,
            };
        }
    }

    return {
        ...original,
        Like: MockLike,
        Undo: MockUndo,
    };
});

vi.mock('@/lookup-helpers', () => ({
    lookupActor: vi.fn(),
    lookupObject: vi.fn(),
}));

describe('LikeController', () => {
    let account: Account;
    let controller: LikeController;
    let postService: PostService;
    let postRepository: KnexPostRepository;
    let fedify: Federation<ContextData>;
    let mockApCtx: FedifyContext;
    let mockGlobalDb: {
        get: ReturnType<typeof vi.fn>;
        set: ReturnType<typeof vi.fn>;
        delete: ReturnType<typeof vi.fn>;
    };
    let mockLogger: {
        info: ReturnType<typeof vi.fn>;
        warn: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
        account = await createTestInternalAccount(123, {
            host: new URL('https://example.com'),
            username: 'index',
            name: 'Example',
            bio: null,
            url: new URL('https://example.com/'),
            avatarUrl: null,
            bannerImageUrl: null,
            customFields: null,
        });

        postService = {
            getByApId: vi.fn().mockResolvedValue(error('not-a-post')),
            likePost: vi.fn().mockResolvedValue(ok(undefined)),
        } as unknown as PostService;
        postRepository = {
            save: vi.fn(),
        } as unknown as KnexPostRepository;
        mockGlobalDb = {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn(),
            delete: vi.fn(),
        };
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
        };
        mockApCtx = {
            getActor: vi.fn().mockResolvedValue(account.apId),
            getFollowersUri: vi
                .fn()
                .mockReturnValue(new URL('https://example.com/followers')),
            getObjectUri: vi.fn((type: unknown, { id }: { id: string }) => {
                if (type === Like) {
                    return new URL(`https://example.com/like/${id}`);
                }

                if (type === Undo) {
                    return new URL(`https://example.com/undo/${id}`);
                }

                return new URL(`https://example.com/object/${id}`);
            }),
            sendActivity: vi.fn(),
        } as unknown as FedifyContext;
        fedify = {
            createContext: vi.fn().mockReturnValue(mockApCtx),
        } as unknown as Federation<ContextData>;
        controller = new LikeController(postService, postRepository, fedify);

        vi.mocked(lookupHelpers.lookupObject).mockResolvedValue({
            id: new URL('https://remote.example/post/1'),
            attributionId: null,
        } as unknown as APObject);
        vi.mocked(lookupHelpers.lookupActor).mockResolvedValue(null);
    });

    function getMockContext(id: string): AppContext {
        return {
            req: {
                param: (key: string) => {
                    if (key === 'id') {
                        return id;
                    }

                    return null;
                },
                raw: {} as Request,
            },
            get: (key: string) => {
                if (key === 'account') return account;
                if (key === 'globaldb') return mockGlobalDb;
                if (key === 'logger') return mockLogger;

                return null;
            },
        } as unknown as AppContext;
    }

    it('sends a successful wire-only like', async () => {
        const response = await controller.handleLike(
            getMockContext('https://remote.example/post/1'),
        );

        expect(response.status).toBe(200);
        expect(mockApCtx.sendActivity).toHaveBeenCalled();
    });

    it('logs when a wire-only like send fails', async () => {
        const sendActivity = mockApCtx.sendActivity as ReturnType<typeof vi.fn>;
        sendActivity.mockRejectedValueOnce(new Error('send failed'));

        const response = await controller.handleLike(
            getMockContext('https://remote.example/post/1'),
        );

        expect(response.status).toBe(200);
        expect(mockLogger.warn).toHaveBeenCalledWith(
            'Failed to send like activity',
            expect.objectContaining({
                accountId: account.id,
                objectId: 'https://remote.example/post/1',
            }),
        );
    });

    it('persists a local like', async () => {
        vi.mocked(postService.getByApId).mockResolvedValue(ok({} as never));

        const response = await controller.handleLike(
            getMockContext('https://remote.example/post/1'),
        );

        expect(response.status).toBe(200);
        expect(postService.likePost).toHaveBeenCalled();
    });

    it('sends a successful wire-only unlike', async () => {
        mockGlobalDb.get.mockResolvedValue({
            type: 'Like',
            id: 'https://example.com/like/existing',
        });

        const response = await controller.handleUnlike(
            getMockContext('https://remote.example/post/1'),
        );

        expect(response.status).toBe(200);
        expect(mockApCtx.sendActivity).toHaveBeenCalled();
    });

    it('logs when a wire-only unlike send fails', async () => {
        mockGlobalDb.get.mockResolvedValue({
            type: 'Like',
            id: 'https://example.com/like/existing',
        });
        const sendActivity = mockApCtx.sendActivity as ReturnType<typeof vi.fn>;
        sendActivity.mockRejectedValueOnce(new Error('send failed'));

        const response = await controller.handleUnlike(
            getMockContext('https://remote.example/post/1'),
        );

        expect(response.status).toBe(200);
        expect(mockLogger.warn).toHaveBeenCalledWith(
            'Failed to send unlike activity',
            expect.objectContaining({
                accountId: account.id,
                objectId: 'https://remote.example/post/1',
            }),
        );
    });
});
