import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Account } from '@/account/account.entity';
import type { AppContext } from '@/app';
import { BlueskyController } from '@/http/api/bluesky.controller';
import type { BlueskyService } from '@/integration/bluesky.service';

describe('BlueskyController', () => {
    let account: Account;
    let ctx: AppContext;
    let blueskyService: BlueskyService;
    let controller: BlueskyController;

    beforeEach(() => {
        account = {
            id: 1,
        } as unknown as Account;

        ctx = {
            get: (key: string) => {
                if (key === 'account') {
                    return account;
                }

                if (key === 'logger') {
                    return {
                        error: vi.fn(),
                    };
                }
                return null;
            },
        } as unknown as AppContext;

        blueskyService = {
            enableForAccount: vi
                .fn()
                .mockResolvedValue('@index.example.com.ap.brid.gy'),
            disableForAccount: vi.fn().mockResolvedValue(undefined),
        } as unknown as BlueskyService;

        controller = new BlueskyController(blueskyService);
    });

    describe('handleEnable', () => {
        it('should enable the Bluesky integration for the account associated with the request user', async () => {
            const result = await controller.handleEnable(ctx);

            expect(result.status).toBe(200);

            const body = await result.json();

            expect(body.handle).toBe('@index.example.com.ap.brid.gy');
        });

        it('should return 500 if an error occurs', async () => {
            const error = new Error('Something went wrong');

            vi.mocked(blueskyService.enableForAccount).mockRejectedValue(error);

            const result = await controller.handleEnable(ctx);

            expect(blueskyService.enableForAccount).toHaveBeenCalledWith(
                account,
            );

            expect(result.status).toBe(500);

            const body = await result.json();

            expect(body.message).toBe('Failed to enable Bluesky integration');
        });
    });

    describe('handleDisable', () => {
        it('should disable the Bluesky integration for the account associated with the request user', async () => {
            const result = await controller.handleDisable(ctx);

            expect(blueskyService.disableForAccount).toHaveBeenCalledWith(
                account,
            );
            expect(result.status).toBe(204);
            expect(result.body).toBe(null);
        });

        it('should return 500 if an error occurs', async () => {
            const error = new Error('Something went wrong');

            vi.mocked(blueskyService.disableForAccount).mockRejectedValue(
                error,
            );

            const result = await controller.handleDisable(ctx);

            expect(blueskyService.disableForAccount).toHaveBeenCalledWith(
                account,
            );

            expect(result.status).toBe(500);

            const body = await result.json();

            expect(body.message).toBe('Failed to disable Bluesky integration');
        });
    });
});
