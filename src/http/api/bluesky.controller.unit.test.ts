import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Account } from '@/account/account.entity';
import type { AppContext } from '@/app';
import { error, ok } from '@/core/result';
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
            enableForAccount: vi.fn().mockResolvedValue({
                enabled: true,
                handleConfirmed: false,
                handle: null,
            }),
            disableForAccount: vi.fn().mockResolvedValue(undefined),
            confirmHandleForAccount: vi.fn(),
            useDomainHandleForAccount: vi.fn(),
        } as unknown as BlueskyService;

        controller = new BlueskyController(blueskyService);
    });

    describe('handleEnable', () => {
        it('should enable the Bluesky integration for the account associated with the request user', async () => {
            const result = await controller.handleEnable(ctx);

            expect(result.status).toBe(200);

            const body = await result.json();

            expect(body).toEqual({
                enabled: true,
                handleConfirmed: false,
                handle: null,
            });
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
            const mockError = new Error('Something went wrong');

            vi.mocked(blueskyService.disableForAccount).mockRejectedValue(
                mockError,
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

    describe('handleConfirmHandle', () => {
        it('should return confirmed handle on success', async () => {
            const mockHandle = '@test.example.com.ap.brid.gy';

            vi.mocked(blueskyService.confirmHandleForAccount).mockResolvedValue(
                ok({
                    handleConfirmed: true,
                    handle: mockHandle,
                    domainHandle: null,
                }),
            );

            const result = await controller.handleConfirmHandle(ctx);
            const body = await result.json();

            expect(result.status).toBe(200);
            expect(body).toEqual({
                enabled: true,
                handleConfirmed: true,
                handle: mockHandle,
                domainHandle: null,
            });
        });

        it('should return unconfirmed status when handle not found', async () => {
            vi.mocked(blueskyService.confirmHandleForAccount).mockResolvedValue(
                ok({
                    handleConfirmed: false,
                    handle: null,
                    domainHandle: null,
                }),
            );

            const result = await controller.handleConfirmHandle(ctx);
            const body = await result.json();

            expect(result.status).toBe(200);
            expect(body).toEqual({
                enabled: true,
                handleConfirmed: false,
                handle: null,
                domainHandle: null,
            });
        });

        it('should return 400 when integration not enabled', async () => {
            vi.mocked(blueskyService.confirmHandleForAccount).mockResolvedValue(
                error({ type: 'not-enabled' }),
            );

            const result = await controller.handleConfirmHandle(ctx);

            expect(result.status).toBe(400);
        });

        it('should return 500 on API errors', async () => {
            vi.mocked(blueskyService.confirmHandleForAccount).mockResolvedValue(
                error({
                    type: 'network-error',
                    message: 'timeout',
                }),
            );

            const result = await controller.handleConfirmHandle(ctx);

            expect(result.status).toBe(500);
        });

        it('should include the domain handle', async () => {
            vi.mocked(blueskyService.confirmHandleForAccount).mockResolvedValue(
                ok({
                    handleConfirmed: true,
                    handle: 'index.example.com.ap.brid.gy',
                    domainHandle: {
                        domain: 'example.com',
                        status: 'claiming',
                        reason: null,
                        automatic: false,
                    },
                }),
            );

            const result = await controller.handleConfirmHandle(ctx);
            const body = await result.json();

            expect(body.domainHandle).toEqual({
                domain: 'example.com',
                status: 'claiming',
                reason: null,
                automatic: false,
            });
        });

        it('should return 500 when the claim throws', async () => {
            vi.mocked(blueskyService.confirmHandleForAccount).mockRejectedValue(
                new Error('Failed to send'),
            );

            const result = await controller.handleConfirmHandle(ctx);

            expect(result.status).toBe(500);
        });
    });

    describe('handleUseDomainHandle', () => {
        it('should return the domain handle details', async () => {
            vi.mocked(
                blueskyService.useDomainHandleForAccount,
            ).mockResolvedValue(
                ok({
                    handleConfirmed: true,
                    handle: 'index.example.com.ap.brid.gy',
                    domainHandle: {
                        domain: 'example.com',
                        status: 'unavailable',
                        reason: 'taken',
                        automatic: false,
                    },
                }),
            );

            const result = await controller.handleUseDomainHandle(ctx);

            expect(
                blueskyService.useDomainHandleForAccount,
            ).toHaveBeenCalledWith(account);
            expect(result.status).toBe(200);
            expect(await result.json()).toEqual({
                enabled: true,
                handleConfirmed: true,
                handle: 'index.example.com.ap.brid.gy',
                domainHandle: {
                    domain: 'example.com',
                    status: 'unavailable',
                    reason: 'taken',
                    automatic: false,
                },
            });
        });

        it.each([
            ['not-enabled', 'Bluesky integration not enabled'],
            ['not-confirmed', 'Bluesky handle not confirmed'],
        ] as const)('should return 400 when %s', async (type, message) => {
            vi.mocked(
                blueskyService.useDomainHandleForAccount,
            ).mockResolvedValue(error({ type }));

            const result = await controller.handleUseDomainHandle(ctx);

            expect(result.status).toBe(400);
            expect(await result.json()).toEqual({ error: message });
        });

        it('should return 500 on API errors', async () => {
            vi.mocked(
                blueskyService.useDomainHandleForAccount,
            ).mockResolvedValue(
                error({ type: 'network-error', message: 'timeout' }),
            );

            const result = await controller.handleUseDomainHandle(ctx);

            expect(result.status).toBe(500);
        });
    });
});
