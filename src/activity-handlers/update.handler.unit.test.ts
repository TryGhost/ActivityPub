import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Note, Person, Update } from '@fedify/vocab';

import type { AccountService } from '@/account/account.service';
import type { FedifyContext } from '@/app';
import { ok } from '@/core/result';
import { UpdateHandler } from './update.handler';

describe('UpdateHandler', () => {
    let handler: UpdateHandler;
    let accountService: {
        updateAccountByApId: ReturnType<typeof vi.fn>;
    };
    let ctx: FedifyContext;

    const aliceApId = new URL('https://mastodon.example/users/alice');
    const bobApId = new URL(
        'https://ghost.example/.ghost/activitypub/users/index',
    );

    beforeEach(() => {
        ctx = {
            data: {
                logger: {
                    debug: vi.fn(),
                },
            },
        } as unknown as FedifyContext;

        accountService = {
            updateAccountByApId: vi.fn().mockResolvedValue(ok(true)),
        };

        handler = new UpdateHandler(
            accountService as unknown as AccountService,
        );
    });

    it('updates the account when the actor updates its own profile', async () => {
        const update = new Update({
            id: new URL('https://mastodon.example/users/alice#updates/1'),
            actor: aliceApId,
            object: new Person({
                id: aliceApId,
                preferredUsername: 'alice',
                name: 'Alice Updated',
                summary: 'New bio',
            }),
        });

        await handler.handle(ctx, update);

        expect(accountService.updateAccountByApId).toHaveBeenCalledTimes(1);

        const [apId, data] = accountService.updateAccountByApId.mock.calls[0];
        expect(apId.href).toBe(aliceApId.href);
        expect(data.name).toBe('Alice Updated');
        expect(data.bio).toBe('New bio');
        expect(data.username).toBe('alice');
    });

    it('does not update the account when the actor differs from the object', async () => {
        const update = new Update({
            id: new URL('https://ghost.example/updates/1'),
            actor: aliceApId,
            object: new Person({
                id: bobApId,
                preferredUsername: 'index',
                name: 'Bob Updated',
                summary: 'New bio',
            }),
        });

        await handler.handle(ctx, update);

        expect(accountService.updateAccountByApId).not.toHaveBeenCalled();
    });

    it('does not update the account when the activity has no actor', async () => {
        const update = new Update({
            id: new URL('https://ghost.example/updates/1'),
            object: new Person({
                id: bobApId,
                preferredUsername: 'index',
                name: 'Bob Updated',
            }),
        });

        await handler.handle(ctx, update);

        expect(accountService.updateAccountByApId).not.toHaveBeenCalled();
    });

    it('does not update the account when the object is not an actor', async () => {
        const update = new Update({
            id: new URL('https://mastodon.example/users/alice#updates/1'),
            actor: aliceApId,
            object: new Note({
                id: new URL('https://mastodon.example/notes/1'),
                content: 'Hello',
            }),
        });

        await handler.handle(ctx, update);

        expect(accountService.updateAccountByApId).not.toHaveBeenCalled();
    });
});
