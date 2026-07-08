import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '@/app';
import { GhostPostController } from '@/http/api/ghost-post.controller';
import type { GhostPostView } from '@/http/api/views/ghost-post.view';

const GHOST_UUID = '259e92cb-5ac2-4d62-910f-ddea29b2cf55';
const ACCOUNT_ID = 123;

function getMockAppContext(uuid: string): AppContext {
    return {
        req: {
            param: (name: string) => (name === 'uuid' ? uuid : undefined),
        },
        get: (key: string) => {
            if (key === 'account') {
                return { id: ACCOUNT_ID };
            }
            return undefined;
        },
        redirect: (location: string, status: number) =>
            new Response(null, {
                status,
                headers: {
                    Location: location,
                },
            }),
    } as unknown as AppContext;
}

describe('GhostPostController', () => {
    let ghostPostView: GhostPostView;
    let controller: GhostPostController;

    beforeEach(() => {
        ghostPostView = {
            getApIdByGhostUuid: vi.fn(),
        } as unknown as GhostPostView;

        controller = new GhostPostController(ghostPostView);
    });

    describe('handleGetByGhostUuid', () => {
        it('should redirect to the AP id of the post', async () => {
            const apId =
                'https://example.com/.ghost/activitypub/article/f4e37194-c235-4d63-9d55-88f764f9c163';

            vi.mocked(ghostPostView.getApIdByGhostUuid).mockResolvedValue(apId);

            const response = await controller.handleGetByGhostUuid(
                getMockAppContext(GHOST_UUID),
            );

            expect(ghostPostView.getApIdByGhostUuid).toHaveBeenCalledWith(
                GHOST_UUID,
                ACCOUNT_ID,
            );
            expect(response.status).toBe(302);
            expect(response.headers.get('Location')).toBe(apId);
        });

        it('should return a 404 if no post is found for the Ghost UUID', async () => {
            vi.mocked(ghostPostView.getApIdByGhostUuid).mockResolvedValue(null);

            const response = await controller.handleGetByGhostUuid(
                getMockAppContext(GHOST_UUID),
            );

            expect(response.status).toBe(404);
        });
    });
});
