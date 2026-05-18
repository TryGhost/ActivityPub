import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AwilixContainer } from 'awilix';
import { Hono } from 'hono';

import type { Account } from '@/account/account.entity';
import type { KnexAccountRepository } from '@/account/account.repository.knex';
import type { AccountService } from '@/account/account.service';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import type { AppContext, HonoContextVariables } from '@/app';
import { error, ok } from '@/core/result';
import { AccountController } from '@/http/api/account.controller';
import type { AccountFollowsView } from '@/http/api/views/account.follows.view';
import type { AccountPostsView } from '@/http/api/views/account.posts.view';
import type { AccountView } from '@/http/api/views/account.view';
import {
    ROLES_METADATA_KEY,
    ROUTES_METADATA_KEY,
} from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';
import { RouteRegistry } from '@/http/routing/route-registry';
import type { Site } from '@/site/site.service';

describe('AccountController aliases', () => {
    let accountRepository: KnexAccountRepository;
    let accountService: AccountService;
    let controller: AccountController;
    let account: Account;
    let site: Site;

    const createContext = (body?: unknown) =>
        ({
            get: vi.fn((key: string) => {
                if (key === 'site') {
                    return site;
                }

                return undefined;
            }),
            req: {
                json: vi.fn().mockResolvedValue(body),
            },
        }) as unknown as AppContext;

    beforeEach(() => {
        site = {
            id: 1,
            host: 'example.com',
            webhook_secret: 'secret',
            ghost_uuid: 'ghost-uuid',
        };
        account = {
            id: 1,
            username: 'index',
            apId: new URL('https://example.com/.ghost/activitypub/users/index'),
            alsoKnownAs: [],
        } as unknown as Account;
        accountRepository = {
            getById: vi.fn().mockResolvedValue(account),
        } as unknown as KnexAccountRepository;
        accountService = {
            getAccountForSite: vi.fn().mockResolvedValue(account),
            getAccountById: vi.fn().mockResolvedValue(account),
            addAlias: vi.fn(),
            removeAlias: vi.fn(),
        } as unknown as AccountService;
        controller = new AccountController(
            {} as AccountView,
            accountRepository,
            {} as AccountFollowsView,
            {} as FedifyContextFactory,
            {} as AccountPostsView,
            accountService,
        );
    });

    it('registers authenticated alias routes', () => {
        const routes = Reflect.getMetadata(
            ROUTES_METADATA_KEY,
            AccountController.prototype,
        );

        expect(routes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    method: 'GET',
                    path: '/.ghost/activitypub/:version/account/aliases',
                    methodName: 'handleGetAccountAliases',
                }),
                expect.objectContaining({
                    method: 'POST',
                    path: '/.ghost/activitypub/:version/account/aliases',
                    methodName: 'handleAddAccountAlias',
                }),
                expect.objectContaining({
                    method: 'DELETE',
                    path: '/.ghost/activitypub/:version/account/aliases',
                    methodName: 'handleRemoveAccountAlias',
                }),
            ]),
        );

        for (const methodName of [
            'handleGetAccountAliases',
            'handleAddAccountAlias',
            'handleRemoveAccountAlias',
        ]) {
            expect(
                Reflect.getMetadata(
                    ROLES_METADATA_KEY,
                    AccountController.prototype,
                    methodName,
                ),
            ).toEqual([GhostRole.Owner, GhostRole.Administrator]);
        }
    });

    it('serves aliases through mounted routes', async () => {
        const app = new Hono<{ Variables: HonoContextVariables }>();
        const routeRegistry = new RouteRegistry();
        const container = {
            resolve: vi.fn().mockReturnValue(controller),
        } as unknown as AwilixContainer;
        const updatedAccount = {
            ...account,
            alsoKnownAs: [new URL('https://mastodon.social/users/old')],
        } as Account;

        app.use('*', async (ctx, next) => {
            ctx.set('site', site);
            await next();
        });
        routeRegistry.registerRoute({
            method: 'GET',
            path: '/.ghost/activitypub/:version/account/:handle',
            controllerToken: 'accountController',
            methodName: 'handleGetAccount',
            versions: ['v1'],
        });
        routeRegistry.registerRoute({
            method: 'POST',
            path: '/.ghost/activitypub/:version/account/aliases',
            controllerToken: 'accountController',
            methodName: 'handleAddAccountAlias',
            versions: ['v1'],
        });
        routeRegistry.registerRoute({
            method: 'GET',
            path: '/.ghost/activitypub/:version/account/aliases',
            controllerToken: 'accountController',
            methodName: 'handleGetAccountAliases',
            versions: ['v1'],
        });
        routeRegistry.registerRoute({
            method: 'DELETE',
            path: '/.ghost/activitypub/:version/account/aliases',
            controllerToken: 'accountController',
            methodName: 'handleRemoveAccountAlias',
            versions: ['v1'],
        });
        routeRegistry.mountRoutes(app, container);

        vi.mocked(accountService.getAccountForSite).mockResolvedValue(
            updatedAccount,
        );

        const getResponse = await app.request(
            '/.ghost/activitypub/v1/account/aliases',
        );

        expect(getResponse.status).toBe(200);
        expect(await getResponse.json()).toEqual({
            destination: {
                handle: '@index@example.com',
                apId: 'https://example.com/.ghost/activitypub/users/index',
            },
            aliases: [{ apId: 'https://mastodon.social/users/old' }],
        });

        vi.mocked(accountService.getAccountForSite).mockResolvedValue(account);
        vi.mocked(accountService.addAlias).mockResolvedValue(
            ok(new URL('https://mastodon.social/users/old')),
        );
        vi.mocked(accountService.getAccountById).mockResolvedValue(
            updatedAccount,
        );

        const postResponse = await app.request(
            '/.ghost/activitypub/v1/account/aliases',
            {
                method: 'POST',
                body: JSON.stringify({
                    sourceHandle: '@old@mastodon.social',
                }),
            },
        );

        expect(postResponse.status).toBe(200);
        expect(accountService.addAlias).toHaveBeenCalledWith(
            account,
            '@old@mastodon.social',
        );

        vi.mocked(accountService.removeAlias).mockResolvedValue(ok(true));
        vi.mocked(accountService.getAccountById).mockResolvedValue(account);

        const deleteResponse = await app.request(
            '/.ghost/activitypub/v1/account/aliases',
            {
                method: 'DELETE',
                body: JSON.stringify({
                    actorUri: 'https://mastodon.social/users/old',
                }),
            },
        );

        expect(deleteResponse.status).toBe(200);
        expect(accountService.removeAlias).toHaveBeenCalledWith(
            account,
            'https://mastodon.social/users/old',
        );
    });

    it('returns account aliases', async () => {
        account = {
            ...account,
            alsoKnownAs: [new URL('https://mastodon.social/users/old')],
        } as Account;
        vi.mocked(accountService.getAccountForSite).mockResolvedValue(account);

        const response = await controller.handleGetAccountAliases(
            createContext(),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            destination: {
                handle: '@index@example.com',
                apId: 'https://example.com/.ghost/activitypub/users/index',
            },
            aliases: [{ apId: 'https://mastodon.social/users/old' }],
        });
    });

    it('returns not found when the site account is missing', async () => {
        vi.mocked(accountService.getAccountForSite).mockResolvedValue(
            null as never,
        );

        const response = await controller.handleGetAccountAliases(
            createContext(),
        );

        expect(response.status).toBe(404);
    });

    it('adds an alias and returns the updated alias list', async () => {
        const updatedAccount = {
            ...account,
            alsoKnownAs: [new URL('https://mastodon.social/users/old')],
        } as Account;

        vi.mocked(accountService.addAlias).mockResolvedValue(
            ok(new URL('https://mastodon.social/users/old')),
        );
        vi.mocked(accountService.getAccountById).mockResolvedValue(
            updatedAccount,
        );

        const response = await controller.handleAddAccountAlias(
            createContext({ sourceHandle: '@old@mastodon.social' }),
        );

        expect(response.status).toBe(200);
        expect(accountService.addAlias).toHaveBeenCalledWith(
            account,
            '@old@mastodon.social',
        );
        expect(await response.json()).toEqual({
            destination: {
                handle: '@index@example.com',
                apId: 'https://example.com/.ghost/activitypub/users/index',
            },
            aliases: [{ apId: 'https://mastodon.social/users/old' }],
        });
    });

    it('maps alias add validation errors to bad request', async () => {
        vi.mocked(accountService.addAlias).mockResolvedValue(
            error('invalid-handle'),
        );

        const response = await controller.handleAddAccountAlias(
            createContext({ sourceHandle: 'old@mastodon.social' }),
        );

        expect(response.status).toBe(400);
    });

    it('maps alias lookup failures to not found', async () => {
        vi.mocked(accountService.addAlias).mockResolvedValue(
            error('lookup-failed'),
        );

        const response = await controller.handleAddAccountAlias(
            createContext({ sourceHandle: '@old@mastodon.social' }),
        );

        expect(response.status).toBe(404);
    });

    it('maps alias removal lookup failures to not found', async () => {
        vi.mocked(accountService.removeAlias).mockResolvedValue(
            error('lookup-failed'),
        );

        const response = await controller.handleRemoveAccountAlias(
            createContext({
                actorUri: 'https://mastodon.social/users/old',
            }),
        );

        expect(response.status).toBe(404);
    });

    it('removes aliases idempotently', async () => {
        vi.mocked(accountService.removeAlias).mockResolvedValue(ok(true));

        const response = await controller.handleRemoveAccountAlias(
            createContext({
                actorUri: 'https://mastodon.social/users/old',
            }),
        );

        expect(response.status).toBe(200);
        expect(accountService.removeAlias).toHaveBeenCalledWith(
            account,
            'https://mastodon.social/users/old',
        );
        expect(await response.json()).toEqual({
            destination: {
                handle: '@index@example.com',
                apId: 'https://example.com/.ghost/activitypub/users/index',
            },
            aliases: [],
        });
    });
});
