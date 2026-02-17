import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '@logtape/logtape';

import type { AppContext } from '@/app';
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
            updateArticleFromGhostPost: vi.fn(),
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
            expect(
                ghostPostService.updateArticleFromGhostPost,
            ).not.toHaveBeenCalled();
        });
    });
});
