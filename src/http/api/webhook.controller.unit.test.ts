import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '@logtape/logtape';

import type { AppContext } from '@/app';
import { error } from '@/core/result';
import type { GhostPostService } from '@/ghost/ghost-post.service';
import { WebhookController } from '@/http/api/webhook.controller';

function createValidPostPayload(
    overrides: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        uuid: '259e92cb-5ac2-4d62-910f-ddea29b2cf55',
        title: 'Test Post',
        html: '<p>Test content</p>',
        excerpt: 'Test excerpt',
        custom_excerpt: null,
        feature_image: null,
        published_at: '2025-01-01T00:00:00Z',
        url: 'https://example.com/test-post',
        visibility: 'public',
        authors: [{ name: 'Test Author', profile_image: null }],
        ...overrides,
    };
}

function getMockAppContext(body: unknown): AppContext {
    return {
        req: {
            json: () => Promise.resolve(body),
        },
        get: (key: string) => {
            if (key === 'account') {
                return { id: 1, name: 'Test Account' };
            }
            return undefined;
        },
    } as unknown as AppContext;
}

describe('WebhookController', () => {
    let ghostPostService: GhostPostService;
    let logger: Logger;
    let controller: WebhookController;

    beforeEach(() => {
        ghostPostService = {
            createGhostPost: vi.fn(),
            updateGhostPost: vi.fn(),
            deleteGhostPost: vi.fn(),
        } as unknown as GhostPostService;

        logger = {
            info: vi.fn(),
            error: vi.fn(),
        } as unknown as Logger;

        controller = new WebhookController(ghostPostService, logger);
    });

    describe('handlePostPublished', () => {
        it('returns 400 when published_at is before 1970', async () => {
            const ctx = getMockAppContext({
                post: {
                    current: createValidPostPayload({
                        published_at: '1969-12-31T23:59:59Z',
                    }),
                },
            });

            const response = await controller.handlePostPublished(ctx);

            expect(response.status).toBe(400);
            expect(ghostPostService.createGhostPost).not.toHaveBeenCalled();
        });

        it('returns 400 when published_at is epoch zero', async () => {
            const ctx = getMockAppContext({
                post: {
                    current: createValidPostPayload({
                        published_at: '1970-01-01T00:00:00Z',
                    }),
                },
            });

            const response = await controller.handlePostPublished(ctx);

            expect(response.status).toBe(400);
            expect(ghostPostService.createGhostPost).not.toHaveBeenCalled();
        });

        it('returns 400 when published_at is a very old date', async () => {
            const ctx = getMockAppContext({
                post: {
                    current: createValidPostPayload({
                        published_at: '0001-01-01T00:00:00Z',
                    }),
                },
            });

            const response = await controller.handlePostPublished(ctx);

            expect(response.status).toBe(400);
            expect(ghostPostService.createGhostPost).not.toHaveBeenCalled();
        });

        it('passes the share settings of the post to the service', async () => {
            vi.mocked(ghostPostService.createGhostPost).mockResolvedValue(
                error('not-shared'),
            );
            const ctx = getMockAppContext({
                post: {
                    current: createValidPostPayload({
                        social_web_share: 'note',
                        social_web_note: 'Read my new post',
                    }),
                },
            });

            await controller.handlePostPublished(ctx);

            expect(ghostPostService.createGhostPost).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    social_web_share: 'note',
                    social_web_note: 'Read my new post',
                }),
            );
        });

        it('returns 400 when the share setting is not recognised', async () => {
            const ctx = getMockAppContext({
                post: {
                    current: createValidPostPayload({
                        social_web_share: 'everywhere',
                    }),
                },
            });

            const response = await controller.handlePostPublished(ctx);

            expect(response.status).toBe(400);
            expect(ghostPostService.createGhostPost).not.toHaveBeenCalled();
        });

        it('returns 200 without a body when the post is not shared', async () => {
            vi.mocked(ghostPostService.createGhostPost).mockResolvedValue(
                error('not-shared'),
            );
            const ctx = getMockAppContext({
                post: {
                    current: createValidPostPayload({
                        social_web_share: 'none',
                    }),
                },
            });

            const response = await controller.handlePostPublished(ctx);

            expect(response.status).toBe(200);
            expect(await response.text()).toBe('');
            expect(logger.error).not.toHaveBeenCalled();
        });
    });

    describe('handlePostUnpublished', () => {
        it('returns 200 when the post was never shared', async () => {
            vi.mocked(ghostPostService.deleteGhostPost).mockResolvedValue(
                error('post-not-found'),
            );
            const ctx = getMockAppContext({
                post: {
                    current: { uuid: '259e92cb-5ac2-4d62-910f-ddea29b2cf55' },
                },
            });

            const response = await controller.handlePostUnpublished(ctx);

            expect(response.status).toBe(200);
            expect(logger.error).not.toHaveBeenCalled();
        });

        it('returns 403 when the post belongs to another account', async () => {
            vi.mocked(ghostPostService.deleteGhostPost).mockResolvedValue(
                error('not-author'),
            );
            const ctx = getMockAppContext({
                post: {
                    current: { uuid: '259e92cb-5ac2-4d62-910f-ddea29b2cf55' },
                },
            });

            const response = await controller.handlePostUnpublished(ctx);

            expect(response.status).toBe(403);
        });
    });

    describe('handlePostUpdated', () => {
        it('returns 400 when published_at is before 1970', async () => {
            const ctx = getMockAppContext({
                post: {
                    current: createValidPostPayload({
                        published_at: '1969-06-15T00:00:00Z',
                    }),
                },
            });

            const response = await controller.handlePostUpdated(ctx);

            expect(response.status).toBe(400);
            expect(ghostPostService.updateGhostPost).not.toHaveBeenCalled();
        });
    });
});
