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
            webfingerHost: null,
        } as unknown as Account;
        accountRepository = {
            getById: vi.fn().mockResolvedValue(account),
        } as unknown as KnexAccountRepository;
        accountService = {
            getAccountForSite: vi.fn().mockResolvedValue(account),
            getAliases: vi.fn().mockResolvedValue([]),
            addAlias: vi.fn(),
            removeAlias: vi.fn(),
            setWebfingerHost: vi.fn(),
            validateWebfingerHost: vi.fn(),
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
                    path: '/.ghost/activitypub/:version/aliases',
                    methodName: 'handleGetAccountAliases',
                }),
                expect.objectContaining({
                    method: 'POST',
                    path: '/.ghost/activitypub/:version/aliases',
                    methodName: 'handleAddAccountAlias',
                }),
                expect.objectContaining({
                    method: 'DELETE',
                    path: '/.ghost/activitypub/:version/aliases',
                    methodName: 'handleRemoveAccountAlias',
                }),
                expect.objectContaining({
                    method: 'GET',
                    path: '/.ghost/activitypub/:version/domain',
                    methodName: 'handleGetAccountDomain',
                }),
                expect.objectContaining({
                    method: 'PUT',
                    path: '/.ghost/activitypub/:version/domain',
                    methodName: 'handleUpdateAccountDomain',
                }),
                expect.objectContaining({
                    method: 'POST',
                    path: '/.ghost/activitypub/:version/domain/validate',
                    methodName: 'handleValidateAccountDomain',
                }),
            ]),
        );

        for (const methodName of [
            'handleGetAccountAliases',
            'handleAddAccountAlias',
            'handleRemoveAccountAlias',
            'handleGetAccountDomain',
            'handleUpdateAccountDomain',
            'handleValidateAccountDomain',
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

        app.use('*', async (ctx, next) => {
            ctx.set('site', site);
            await next();
        });
        routeRegistry.registerRoute({
            method: 'GET',
            path: '/.ghost/activitypub/:version/aliases',
            controllerToken: 'accountController',
            methodName: 'handleGetAccountAliases',
            versions: ['v1'],
        });
        routeRegistry.registerRoute({
            method: 'POST',
            path: '/.ghost/activitypub/:version/aliases',
            controllerToken: 'accountController',
            methodName: 'handleAddAccountAlias',
            versions: ['v1'],
        });
        routeRegistry.registerRoute({
            method: 'DELETE',
            path: '/.ghost/activitypub/:version/aliases',
            controllerToken: 'accountController',
            methodName: 'handleRemoveAccountAlias',
            versions: ['v1'],
        });
        routeRegistry.mountRoutes(app, container);

        vi.mocked(accountService.getAliases).mockResolvedValue([
            new URL('https://mastodon.social/users/old'),
        ]);

        const getResponse = await app.request('/.ghost/activitypub/v1/aliases');

        expect(getResponse.status).toBe(200);
        expect(await getResponse.json()).toEqual({
            destination: {
                handle: '@index@example.com',
                apId: 'https://example.com/.ghost/activitypub/users/index',
            },
            aliases: [{ apId: 'https://mastodon.social/users/old' }],
        });

        vi.mocked(accountService.addAlias).mockResolvedValue(
            ok(new URL('https://mastodon.social/users/old')),
        );

        const postResponse = await app.request(
            '/.ghost/activitypub/v1/aliases',
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
        vi.mocked(accountService.getAliases).mockResolvedValue([]);

        const deleteResponse = await app.request(
            '/.ghost/activitypub/v1/aliases',
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
        vi.mocked(accountService.getAliases).mockResolvedValue([
            new URL('https://mastodon.social/users/old'),
        ]);

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

    it('returns account domain state', async () => {
        const response = await controller.handleGetAccountDomain(
            createContext(),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            domain: null,
            handle: '@index@example.com',
            actorUrl: 'https://example.com/.ghost/activitypub/users/index',
        });
    });

    it('updates the account domain', async () => {
        const updatedAccount = {
            ...account,
            webfingerHost: 'site.com',
        } as Account;

        vi.mocked(accountService.setWebfingerHost).mockResolvedValue(
            ok(updatedAccount),
        );

        const response = await controller.handleUpdateAccountDomain(
            createContext({ domain: 'site.com' }),
        );

        expect(response.status).toBe(200);
        expect(accountService.setWebfingerHost).toHaveBeenCalledWith(
            account,
            'site.com',
        );
        expect(await response.json()).toEqual({
            domain: 'site.com',
            handle: '@index@site.com',
            actorUrl: 'https://example.com/.ghost/activitypub/users/index',
        });
    });

    it('clears the account domain', async () => {
        vi.mocked(accountService.setWebfingerHost).mockResolvedValue(
            ok(account),
        );

        const response = await controller.handleUpdateAccountDomain(
            createContext({ domain: null }),
        );

        expect(response.status).toBe(200);
        expect(accountService.setWebfingerHost).toHaveBeenCalledWith(
            account,
            null,
        );
    });

    it('returns conflict when an account domain is already claimed', async () => {
        vi.mocked(accountService.setWebfingerHost).mockResolvedValue(
            error({ type: 'conflict', host: 'site.com' }),
        );

        const response = await controller.handleUpdateAccountDomain(
            createContext({ domain: 'site.com' }),
        );

        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({
            message: 'Domain is already in use',
            code: 'conflict',
        });
    });

    it('returns bad request when an account domain is invalid', async () => {
        vi.mocked(accountService.setWebfingerHost).mockResolvedValue(
            error({ type: 'invalid-domain', host: 'https://site.com' }),
        );

        const response = await controller.handleUpdateAccountDomain(
            createContext({ domain: 'https://site.com' }),
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            message: 'Invalid domain',
            code: 'invalid-domain',
        });
    });

    it('validates an account domain without saving it', async () => {
        vi.mocked(accountService.validateWebfingerHost).mockResolvedValue(
            ok(true),
        );

        const response = await controller.handleValidateAccountDomain(
            createContext({ domain: 'WWW.Site.COM' }),
        );

        expect(response.status).toBe(200);
        expect(accountService.validateWebfingerHost).toHaveBeenCalledWith(
            account,
            'site.com',
        );
        expect(accountService.setWebfingerHost).not.toHaveBeenCalled();
        expect(await response.json()).toEqual({
            domain: 'site.com',
            handle: '@index@site.com',
            actorUrl: 'https://example.com/.ghost/activitypub/users/index',
        });
    });

    it('returns default domain state when validating the fallback account host', async () => {
        const response = await controller.handleValidateAccountDomain(
            createContext({ domain: 'example.com' }),
        );

        expect(response.status).toBe(200);
        expect(accountService.validateWebfingerHost).not.toHaveBeenCalled();
        expect(accountService.setWebfingerHost).not.toHaveBeenCalled();
        expect(await response.json()).toEqual({
            domain: null,
            handle: '@index@example.com',
            actorUrl: 'https://example.com/.ghost/activitypub/users/index',
        });
    });

    it('returns the current domain state when validating a null account domain', async () => {
        const response = await controller.handleValidateAccountDomain(
            createContext({ domain: null }),
        );

        expect(response.status).toBe(200);
        expect(accountService.validateWebfingerHost).not.toHaveBeenCalled();
        expect(accountService.setWebfingerHost).not.toHaveBeenCalled();
        expect(await response.json()).toEqual({
            domain: null,
            handle: '@index@example.com',
            actorUrl: 'https://example.com/.ghost/activitypub/users/index',
        });
    });

    it('returns bad request when validating an invalid account domain', async () => {
        const response = await controller.handleValidateAccountDomain(
            createContext({ domain: 'https://site.com' }),
        );

        expect(response.status).toBe(400);
        expect(accountService.validateWebfingerHost).not.toHaveBeenCalled();
        expect(await response.json()).toEqual({
            message: 'Invalid domain',
            code: 'invalid-domain',
        });
    });

    it('maps account domain validation errors to their status codes', async () => {
        vi.mocked(accountService.validateWebfingerHost).mockResolvedValue(
            error({
                type: 'wrong-actor',
                host: 'site.com',
                expectedActorUrl:
                    'https://example.com/.ghost/activitypub/users/index',
                actualActorUrl: 'https://site.com/users/index',
            }),
        );

        const response = await controller.handleValidateAccountDomain(
            createContext({ domain: 'site.com' }),
        );

        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({
            message: 'Domain does not resolve to this account',
            code: 'wrong-actor',
        });
    });

    it('adds an alias and returns the updated alias list', async () => {
        vi.mocked(accountService.addAlias).mockResolvedValue(
            ok(new URL('https://mastodon.social/users/old')),
        );
        vi.mocked(accountService.getAliases).mockResolvedValue([
            new URL('https://mastodon.social/users/old'),
        ]);

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
