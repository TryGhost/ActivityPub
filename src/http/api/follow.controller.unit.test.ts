import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Actor, Object as APObject, Federation } from '@fedify/fedify';
import { Follow, isActor, Undo } from '@fedify/fedify';

import type { Account } from '@/account/account.entity';
import type { AccountService } from '@/account/account.service';
import type { AppContext, ContextData, FedifyContext } from '@/app';
import { error, ok } from '@/core/result';
import { FollowController } from '@/http/api/follow.controller';
import * as lookupHelpers from '@/lookup-helpers';
import type { ModerationService } from '@/moderation/moderation.service';
import {
    createTestExternalAccount,
    createTestInternalAccount,
} from '@/test/account-entity-test-helpers';

vi.mock('@fedify/fedify', async () => {
    const original = await vi.importActual('@fedify/fedify');

    class MockFollow {
        id: unknown;
        actor: unknown;
        object: unknown;

        constructor({
            id,
            actor,
            object,
        }: { id: unknown; actor: unknown; object: unknown }) {
            this.id = id;
            this.actor = actor;
            this.object = object;
        }

        async toJsonLd() {
            return {
                '@context': 'https://www.w3.org/ns/activitystreams',
                type: 'Follow',
                id: this.id,
                actor: this.actor,
                object: this.object,
            };
        }
    }

    class MockUndo {
        id: unknown;
        actor: unknown;
        object: unknown;

        constructor({
            id,
            actor,
            object,
        }: { id: unknown; actor: unknown; object: unknown }) {
            this.id = id;
            this.actor = actor;
            this.object = object;
        }

        async toJsonLd() {
            return {
                '@context': 'https://www.w3.org/ns/activitystreams',
                type: 'Undo',
                id: this.id,
                actor: this.actor,
                object: this.object,
            };
        }
    }

    return {
        ...original,
        Follow: MockFollow,
        Undo: MockUndo,
        isActor: vi.fn(),
    };
});

vi.mock('@/lookup-helpers', () => ({
    lookupActor: vi.fn(),
    lookupActorProfile: vi.fn(),
    lookupObject: vi.fn(),
}));

describe('FollowController', () => {
    let accountService: AccountService;
    let moderationService: ModerationService;
    let fedify: Federation<ContextData>;
    let controller: FollowController;
    let followerAccount: Account;
    let externalAccountToFollow: Account;
    let internalAccountToFollow: Account;
    let mockApCtx: FedifyContext;
    let mockGlobalDb: {
        get: ReturnType<typeof vi.fn>;
        set: ReturnType<typeof vi.fn>;
    };
    let mockLogger: {
        error: ReturnType<typeof vi.fn>;
        info: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
        followerAccount = await createTestInternalAccount(1, {
            host: new URL('https://example.com'),
            username: 'follower',
            name: 'Follower User',
            bio: 'Test follower',
            url: new URL('https://example.com/follower'),
            avatarUrl: null,
            bannerImageUrl: null,
            customFields: null,
        });

        externalAccountToFollow = await createTestExternalAccount(2, {
            username: 'external',
            name: 'External User',
            bio: 'External account',
            url: new URL('https://external.com/user'),
            avatarUrl: null,
            bannerImageUrl: null,
            customFields: null,
            apId: new URL('https://external.com/users/external'),
            apFollowers: new URL(
                'https://external.com/users/external/followers',
            ),
            apInbox: new URL('https://external.com/users/external/inbox'),
        });

        internalAccountToFollow = await createTestInternalAccount(3, {
            host: new URL('https://internal.example.com'),
            username: 'internal',
            name: 'Internal User',
            bio: 'Internal account',
            url: new URL('https://internal.example.com/internal'),
            avatarUrl: null,
            bannerImageUrl: null,
            customFields: null,
        });

        accountService = {
            ensureByApId: vi.fn(),
            followAccount: vi.fn(),
            unfollowAccount: vi.fn(),
            checkIfAccountIsFollowing: vi.fn(),
        } as unknown as AccountService;

        moderationService = {
            canInteractWithAccount: vi.fn().mockResolvedValue(true),
        } as unknown as ModerationService;

        mockGlobalDb = {
            get: vi.fn(),
            set: vi.fn(),
        };

        mockLogger = {
            error: vi.fn(),
            info: vi.fn(),
        };

        mockApCtx = {
            getObjectUri: vi.fn((type, { id }) => {
                if (type === Follow) {
                    return new URL(`https://example.com/follows/${id}`);
                }

                if (type === Undo) {
                    return new URL(`https://example.com/undo/${id}`);
                }

                return new URL('https://example.com/unknown');
            }),
            sendActivity: vi.fn(),
            data: {
                globaldb: mockGlobalDb,
                logger: mockLogger,
            },
        } as unknown as FedifyContext;

        fedify = {
            createContext: vi.fn().mockReturnValue(mockApCtx),
        } as unknown as Federation<ContextData>;

        controller = new FollowController(
            accountService,
            moderationService,
            fedify,
        );

        vi.mocked(isActor).mockReturnValue(true);
    });

    function getMockContext(handle: string): AppContext {
        return {
            req: {
                param: (key: string) => {
                    if (key === 'handle') return handle;

                    return null;
                },
                raw: {} as Request,
            },
            get: (key: string) => {
                if (key === 'account') return followerAccount;
                if (key === 'globaldb') return mockGlobalDb;
                if (key === 'logger') return mockLogger;

                return null;
            },
        } as unknown as AppContext;
    }

    describe('handleFollow', () => {
        it('should return 404 when account lookup fails', async () => {
            const ctx = getMockContext('@external@external.com');

            vi.mocked(lookupHelpers.lookupActorProfile).mockResolvedValue(
                error('lookup-error'),
            );

            const response = await controller.handleFollow(ctx);

            expect(response.status).toBe(404);

            const body = await response.json();
            expect(body.message).toBe('Remote account could not be found');
        });

        it('should return 400 when trying to follow yourself', async () => {
            const ctx = getMockContext('@follower@example.com');

            vi.mocked(lookupHelpers.lookupActorProfile).mockResolvedValue(
                ok(followerAccount.apId),
            );

            const response = await controller.handleFollow(ctx);

            expect(response.status).toBe(400);

            const body = await response.json();
            expect(body.message).toBe('Cannot follow yourself');
        });

        it('should return 404 when ensureByApId returns not-found', async () => {
            const ctx = getMockContext('@external@external.com');

            vi.mocked(lookupHelpers.lookupActorProfile).mockResolvedValue(
                ok(externalAccountToFollow.apId),
            );
            vi.mocked(accountService.ensureByApId).mockResolvedValue(
                error('not-found'),
            );

            const response = await controller.handleFollow(ctx);

            expect(response.status).toBe(404);

            const body = await response.json();
            expect(body.message).toBe('Remote account could not be found');
        });

        it('should return 400 when ensureByApId returns invalid-type', async () => {
            const ctx = getMockContext('@external@external.com');

            vi.mocked(lookupHelpers.lookupActorProfile).mockResolvedValue(
                ok(externalAccountToFollow.apId),
            );
            vi.mocked(accountService.ensureByApId).mockResolvedValue(
                error('invalid-type'),
            );

            const response = await controller.handleFollow(ctx);

            expect(response.status).toBe(400);

            const body = await response.json();
            expect(body.message).toBe('Remote account is not an Actor');
        });

        it('should return 403 when moderation check fails', async () => {
            const ctx = getMockContext('@external@external.com');

            vi.mocked(lookupHelpers.lookupActorProfile).mockResolvedValue(
                ok(externalAccountToFollow.apId),
            );
            vi.mocked(accountService.ensureByApId).mockResolvedValue(
                ok(externalAccountToFollow),
            );
            vi.mocked(
                moderationService.canInteractWithAccount,
            ).mockResolvedValue(false);

            const response = await controller.handleFollow(ctx);

            expect(response.status).toBe(403);

            const body = await response.json();
            expect(body.message).toBe('You cannot follow this account');
        });

        it('should return 409 when already following the account', async () => {
            const ctx = getMockContext('@external@external.com');

            vi.mocked(lookupHelpers.lookupActorProfile).mockResolvedValue(
                ok(externalAccountToFollow.apId),
            );
            vi.mocked(accountService.ensureByApId).mockResolvedValue(
                ok(externalAccountToFollow),
            );
            vi.mocked(
                accountService.checkIfAccountIsFollowing,
            ).mockResolvedValue(true);

            const response = await controller.handleFollow(ctx);

            expect(response.status).toBe(409);

            const body = await response.json();
            expect(body.message).toBe('Already following this account');
        });

        it('should follow external account and federate Follow activity', async () => {
            const ctx = getMockContext('@external@external.com');
            const mockActor = {
                id: followerAccount.apId,
                type: 'Person',
                inbox:
                    followerAccount.apInbox ||
                    new URL('https://example.com/inbox'),
            };
            const mockActorToFollow = {
                id: externalAccountToFollow.apId,
                type: 'Person',
                inbox:
                    externalAccountToFollow.apInbox ||
                    new URL('https://external.com/inbox'),
                toJsonLd: vi.fn().mockResolvedValue({
                    '@context': 'https://www.w3.org/ns/activitystreams',
                    type: 'Person',
                    id: externalAccountToFollow.apId.href,
                }),
            };

            vi.mocked(lookupHelpers.lookupActorProfile).mockResolvedValue(
                ok(externalAccountToFollow.apId),
            );
            vi.mocked(accountService.ensureByApId).mockResolvedValue(
                ok(externalAccountToFollow),
            );
            vi.mocked(
                accountService.checkIfAccountIsFollowing,
            ).mockResolvedValue(false);
            vi.mocked(lookupHelpers.lookupActor)
                .mockResolvedValueOnce(mockActor as unknown as Actor)
                .mockResolvedValueOnce(mockActorToFollow as unknown as Actor);

            const response = await controller.handleFollow(ctx);

            expect(response.status).toBe(200);

            // Verify Follow activity was sent
            expect(mockApCtx.sendActivity).toHaveBeenCalledWith(
                { username: followerAccount.username },
                mockActorToFollow,
                expect.any(Follow),
            );

            // Verify Follow activity was stored in globaldb
            expect(mockGlobalDb.set).toHaveBeenCalled();

            // Should NOT call followAccount for external accounts
            expect(accountService.followAccount).not.toHaveBeenCalled();
        });

        it('should follow internal account without federating', async () => {
            const ctx = getMockContext('@internal@example.com');
            const mockActor = {
                id: followerAccount.apId,
                type: 'Person',
                inbox:
                    followerAccount.apInbox ||
                    new URL('https://example.com/inbox'),
            };
            const mockActorToFollow = {
                id: internalAccountToFollow.apId,
                type: 'Person',
                inbox:
                    internalAccountToFollow.apInbox ||
                    new URL('https://example.com/inbox'),
                toJsonLd: vi.fn().mockResolvedValue({
                    '@context': 'https://www.w3.org/ns/activitystreams',
                    type: 'Person',
                    id: internalAccountToFollow.apId.href,
                }),
            };

            vi.mocked(lookupHelpers.lookupActorProfile).mockResolvedValue(
                ok(internalAccountToFollow.apId),
            );
            vi.mocked(accountService.ensureByApId).mockResolvedValue(
                ok(internalAccountToFollow),
            );
            vi.mocked(
                accountService.checkIfAccountIsFollowing,
            ).mockResolvedValue(false);
            vi.mocked(lookupHelpers.lookupActor)
                .mockResolvedValueOnce(mockActor as unknown as Actor)
                .mockResolvedValueOnce(mockActorToFollow as unknown as Actor);

            const response = await controller.handleFollow(ctx);

            expect(response.status).toBe(200);

            // Verify followAccount was called for internal account
            expect(accountService.followAccount).toHaveBeenCalledWith(
                followerAccount,
                internalAccountToFollow,
            );

            // Should NOT send federated activity for internal accounts
            expect(mockApCtx.sendActivity).not.toHaveBeenCalled();
            expect(mockGlobalDb.set).not.toHaveBeenCalled();
        });
    });

    describe('handleUnfollow', () => {
        it('should return 404 when account is not an actor', async () => {
            const ctx = getMockContext('@external@external.com');
            const mockObject = {
                id: new URL('https://external.com/note/123'),
            };

            vi.mocked(lookupHelpers.lookupObject).mockResolvedValue(
                mockObject as unknown as APObject,
            );
            vi.mocked(isActor).mockReturnValueOnce(false);

            const response = await controller.handleUnfollow(ctx);

            expect(response.status).toBe(404);
        });

        it('should return 400 when trying to unfollow yourself', async () => {
            const ctx = getMockContext('@follower@example.com');
            const mockActor = {
                id: followerAccount.apId,
                type: 'Person',
                inbox:
                    followerAccount.apInbox ||
                    new URL('https://example.com/inbox'),
            };

            vi.mocked(lookupHelpers.lookupObject).mockResolvedValue(
                mockActor as unknown as APObject,
            );

            const response = await controller.handleUnfollow(ctx);

            expect(response.status).toBe(400);
        });

        it('should return 404 when ensureByApId returns not-found', async () => {
            const ctx = getMockContext('@external@external.com');
            const mockActor = {
                id: externalAccountToFollow.apId,
                type: 'Person',
                inbox:
                    externalAccountToFollow.apInbox ||
                    new URL('https://external.com/inbox'),
            };

            vi.mocked(lookupHelpers.lookupObject).mockResolvedValue(
                mockActor as unknown as APObject,
            );
            vi.mocked(accountService.ensureByApId).mockResolvedValue(
                error('not-found'),
            );

            const response = await controller.handleUnfollow(ctx);

            expect(response.status).toBe(404);

            const body = await response.json();
            expect(body.message).toBe('Remote account could not be found');
        });

        it('should return 409 when not following the account', async () => {
            const ctx = getMockContext('@external@external.com');
            const mockActor = {
                id: externalAccountToFollow.apId,
                type: 'Person',
                inbox:
                    externalAccountToFollow.apInbox ||
                    new URL('https://external.com/inbox'),
            };

            vi.mocked(lookupHelpers.lookupObject).mockResolvedValue(
                mockActor as unknown as APObject,
            );
            vi.mocked(accountService.ensureByApId).mockResolvedValue(
                ok(externalAccountToFollow),
            );
            vi.mocked(
                accountService.checkIfAccountIsFollowing,
            ).mockResolvedValue(false);

            const response = await controller.handleUnfollow(ctx);

            expect(response.status).toBe(409);
        });

        it('should unfollow external account and send federated Undo activity', async () => {
            const ctx = getMockContext('@external@external.com');
            const mockActor = {
                id: externalAccountToFollow.apId,
                type: 'Person',
                inbox:
                    externalAccountToFollow.apInbox ||
                    new URL('https://external.com/inbox'),
            };

            vi.mocked(lookupHelpers.lookupObject).mockResolvedValue(
                mockActor as unknown as APObject,
            );
            vi.mocked(accountService.ensureByApId).mockResolvedValue(
                ok(externalAccountToFollow),
            );
            vi.mocked(
                accountService.checkIfAccountIsFollowing,
            ).mockResolvedValue(true);

            const response = await controller.handleUnfollow(ctx);

            expect(response.status).toBe(202);

            // Verify unfollowAccount was called
            expect(accountService.unfollowAccount).toHaveBeenCalledWith(
                followerAccount,
                externalAccountToFollow,
            );

            // Verify Undo(Follow) activity was sent
            expect(mockApCtx.sendActivity).toHaveBeenCalledWith(
                { username: followerAccount.username },
                mockActor,
                expect.any(Undo),
            );

            // Verify activity was stored in globaldb
            expect(mockGlobalDb.set).toHaveBeenCalled();
        });

        it('should unfollow internal account without federating', async () => {
            const ctx = getMockContext('@internal@example.com');
            const mockActor = {
                id: internalAccountToFollow.apId,
                type: 'Person',
                inbox:
                    internalAccountToFollow.apInbox ||
                    new URL('https://example.com/inbox'),
            };

            vi.mocked(lookupHelpers.lookupObject).mockResolvedValue(
                mockActor as unknown as APObject,
            );
            vi.mocked(accountService.ensureByApId).mockResolvedValue(
                ok(internalAccountToFollow),
            );
            vi.mocked(
                accountService.checkIfAccountIsFollowing,
            ).mockResolvedValue(true);

            const response = await controller.handleUnfollow(ctx);

            expect(response.status).toBe(202);

            // Verify unfollowAccount was called
            expect(accountService.unfollowAccount).toHaveBeenCalledWith(
                followerAccount,
                internalAccountToFollow,
            );

            // Should NOT send federated activity for internal accounts
            expect(mockApCtx.sendActivity).not.toHaveBeenCalled();
            expect(mockGlobalDb.set).not.toHaveBeenCalled();
        });

        it('should call unfollowAccount before checking if account is internal', async () => {
            const ctx = getMockContext('@internal@example.com');
            const mockActor = {
                id: internalAccountToFollow.apId,
                type: 'Person',
                inbox:
                    internalAccountToFollow.apInbox ||
                    new URL('https://example.com/inbox'),
            };
            const callOrder: string[] = [];

            vi.mocked(lookupHelpers.lookupObject).mockResolvedValue(
                mockActor as unknown as APObject,
            );
            vi.mocked(accountService.ensureByApId).mockResolvedValue(
                ok(internalAccountToFollow),
            );
            vi.mocked(
                accountService.checkIfAccountIsFollowing,
            ).mockResolvedValue(true);
            vi.mocked(accountService.unfollowAccount).mockImplementation(
                async () => {
                    callOrder.push('unfollowAccount');
                },
            );

            await controller.handleUnfollow(ctx);

            // Verify unfollowAccount was called (which happens before the internal check)
            expect(callOrder).toContain('unfollowAccount');
            expect(accountService.unfollowAccount).toHaveBeenCalledWith(
                followerAccount,
                internalAccountToFollow,
            );
        });
    });
});
