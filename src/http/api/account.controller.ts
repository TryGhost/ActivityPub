import { z } from 'zod';

import type { Account } from '@/account/account.entity';
import type { KnexAccountRepository } from '@/account/account.repository.knex';
import type { AccountService } from '@/account/account.service';
import { getAccountHandle, getAccountHandleHost } from '@/account/utils';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import type { AppContext } from '@/app';
import { exhaustiveCheck, getError, getValue, isError } from '@/core/result';
import { isHandle } from '@/helpers/activitypub/actor';
import { requireParam } from '@/http/api/helpers/request';
import type { AccountDTO } from '@/http/api/types';
import type {
    AccountFollows,
    AccountFollowsView,
} from '@/http/api/views/account.follows.view';
import type {
    AccountPosts,
    AccountPostsView,
} from '@/http/api/views/account.posts.view';
import type { AccountView } from '@/http/api/views/account.view';
import { APIRoute, RequireRoles } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';
import { lookupActorProfile } from '@/lookup-helpers';

/**
 * Default number of posts to return in a profile
 */
const DEFAULT_POSTS_LIMIT = 20;

/**
 * Maximum number of posts that can be returned in a profile
 */
const MAX_POSTS_LIMIT = 100;

/**
 * Keyword to indicate a request is for the current user
 */
const CURRENT_USER_KEYWORD = 'me';

const AddAliasSchema = z.object({
    sourceHandle: z.string(),
});

const RemoveAliasSchema = z.object({
    actorUri: z.string(),
});

const UpdateDomainSchema = z.object({
    domain: z.string().nullable(),
});

/**
 * Controller for account-related operations
 */
export class AccountController {
    constructor(
        private readonly accountView: AccountView,
        private readonly accountRepository: KnexAccountRepository,
        private readonly accountFollowsView: AccountFollowsView,
        private readonly fedifyContextFactory: FedifyContextFactory,
        private readonly accountPostsView: AccountPostsView,
        private readonly accountService: AccountService,
    ) {}

    private async accountAliasesResponse(account: Account) {
        const aliases = await this.accountService.getAliases(account.id);
        return {
            destination: {
                handle: getAccountHandle(
                    getAccountHandleHost(account),
                    account.username,
                ),
                apId: account.apId.href,
            },
            aliases: aliases.map((alias) => ({
                apId: alias.href,
            })),
        };
    }

    private accountDomainResponse(account: Account) {
        return {
            domain: account.webfingerHost,
            handle: getAccountHandle(
                getAccountHandleHost(account),
                account.username,
            ),
            actorUrl: account.apId.href,
        };
    }

    /**
     * Handle a request for an account
     */
    @APIRoute('GET', 'account/:handle')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleGetAccount(ctx: AppContext) {
        const handle = requireParam(ctx, 'handle');

        if (handle !== CURRENT_USER_KEYWORD && !isHandle(handle)) {
            return new Response(null, { status: 404 });
        }

        const siteDefaultAccount = await this.accountRepository.getBySite(
            ctx.get('site'),
        );

        let accountDto: AccountDTO | null = null;

        const viewContext = {
            requestUserAccount: siteDefaultAccount,
            includeCounts: true,
        };

        if (handle === CURRENT_USER_KEYWORD) {
            accountDto = await this.accountView.viewById(
                siteDefaultAccount.id!,
                viewContext,
            );
        } else {
            accountDto = await this.accountView.viewByHandle(
                handle,
                viewContext,
            );
        }

        if (accountDto === null) {
            return new Response(null, { status: 404 });
        }

        return new Response(JSON.stringify(accountDto), {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    }

    /**
     * Handle a request for a list of account follows
     */
    @APIRoute('GET', 'account/:handle/follows/:type')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleGetAccountFollows(ctx: AppContext) {
        const logger = ctx.get('logger');
        const site = ctx.get('site');

        const handle = requireParam(ctx, 'handle');

        const type = requireParam(ctx, 'type');
        if (!['following', 'followers'].includes(type)) {
            return new Response(null, { status: 400 });
        }

        const siteDefaultAccount = await this.accountRepository.getBySite(site);

        const queryNext = ctx.req.query('next');
        const next = queryNext ? decodeURIComponent(queryNext) : null;

        let accountFollows: AccountFollows;

        if (handle === 'me') {
            accountFollows = await this.accountFollowsView.getFollowsByAccount(
                siteDefaultAccount,
                type,
                Number.parseInt(next || '0', 10),
                siteDefaultAccount,
            );
        } else {
            const ctx = this.fedifyContextFactory.getFedifyContext();
            const lookupResult = await lookupActorProfile(ctx, handle);

            if (isError(lookupResult)) {
                ctx.data.logger.error(
                    `Failed to lookup apId for handle: ${handle}, error: ${getError(lookupResult)}`,
                );
                return new Response(null, { status: 404 });
            }

            const apId = getValue(lookupResult);

            const account = await this.accountRepository.getByApId(apId);

            if (account?.isInternal) {
                accountFollows =
                    await this.accountFollowsView.getFollowsByAccount(
                        account,
                        type,
                        Number.parseInt(next || '0', 10),
                        siteDefaultAccount,
                    );
            } else {
                const result =
                    await this.accountFollowsView.getFollowsByRemoteLookUp(
                        apId,
                        next || '',
                        type,
                        siteDefaultAccount,
                    );
                if (isError(result)) {
                    const error = getError(result);
                    switch (error) {
                        case 'invalid-next-parameter':
                            logger.error('Invalid next parameter');
                            return new Response(null, { status: 400 });
                        case 'not-an-actor':
                            logger.error(`Actor not found for ${handle}`);
                            return new Response(null, { status: 404 });
                        case 'error-getting-follows':
                            logger.error(`Error getting follows for ${handle}`);
                            return new Response(
                                JSON.stringify({
                                    accounts: [],
                                    next: null,
                                }),
                                { status: 200 },
                            );
                        default:
                            return exhaustiveCheck(error);
                    }
                }
                accountFollows = getValue(result);
            }
        }

        // Return response
        return new Response(
            JSON.stringify({
                accounts: accountFollows?.accounts,
                next: accountFollows?.next,
            }),
            {
                headers: {
                    'Content-Type': 'application/json',
                },
                status: 200,
            },
        );
    }

    /**
     * Handle a request for a list of posts by an account
     */
    @APIRoute('GET', 'posts/:handle')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleGetAccountPosts(ctx: AppContext) {
        const params = validateRequestParams(ctx);
        if (!params) {
            return new Response(null, { status: 400 });
        }

        const logger = ctx.get('logger');
        const site = ctx.get('site');

        const handle = requireParam(ctx, 'handle');

        const currentContextAccount =
            await this.accountRepository.getBySite(site);

        let accountPosts: AccountPosts;

        // We are using the keyword 'me', if we want to get the posts of the current user
        if (handle === 'me') {
            const accountPostsResult =
                await this.accountPostsView.getPostsFromOutbox(
                    currentContextAccount,
                    currentContextAccount.id,
                    params.limit,
                    params.cursor,
                );
            if (isError(accountPostsResult)) {
                const error = getError(accountPostsResult);
                switch (error) {
                    case 'not-internal-account':
                        logger.error(`Account is not internal for ${handle}`);
                        return new Response(null, { status: 500 });
                    default:
                        return exhaustiveCheck(error);
                }
            }
            accountPosts = getValue(accountPostsResult);
        } else {
            const ctx = this.fedifyContextFactory.getFedifyContext();
            const lookupResult = await lookupActorProfile(ctx, handle);

            if (isError(lookupResult)) {
                ctx.data.logger.error(
                    `Failed to lookup apId for handle: ${handle}, error: ${getError(lookupResult)}`,
                );
                return new Response(null, { status: 404 });
            }

            const apId = getValue(lookupResult);

            const account = await this.accountRepository.getByApId(apId);

            const result = await this.accountPostsView.getPostsByApId(
                apId,
                account,
                currentContextAccount,
                params.limit,
                params.cursor,
            );
            if (isError(result)) {
                const error = getError(result);
                switch (error) {
                    case 'invalid-next-parameter':
                        logger.error('Invalid next parameter');
                        return new Response(null, { status: 400 });
                    case 'not-an-actor':
                        logger.error(`Actor not found for ${handle}`);
                        return new Response(null, { status: 404 });
                    case 'error-getting-outbox':
                        logger.error(`Error getting outbox for ${handle}`);
                        return new Response(
                            JSON.stringify({
                                posts: [],
                                next: null,
                            }),
                            { status: 200 },
                        );
                    case 'no-page-found':
                        logger.error(`No page found in outbox for ${handle}`);
                        return new Response(
                            JSON.stringify({
                                posts: [],
                                next: null,
                            }),
                            { status: 200 },
                        );
                    default:
                        return exhaustiveCheck(error);
                }
            }
            accountPosts = getValue(result);
        }

        return new Response(
            JSON.stringify({
                posts: accountPosts.results,
                next: accountPosts.nextCursor,
            }),
            { status: 200 },
        );
    }

    /**
     * Handle a request for a list of posts liked by an account
     */
    @APIRoute('GET', 'posts/:handle/liked')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleGetAccountLikedPosts(ctx: AppContext) {
        const params = validateRequestParams(ctx);
        if (!params) {
            return new Response(null, { status: 400 });
        }

        const account = ctx.get('account');

        if (!account) {
            return new Response(null, { status: 404 });
        }

        const { results, nextCursor } =
            await this.accountPostsView.getPostsLikedByAccount(
                account.id,
                params.limit,
                params.cursor,
            );

        return new Response(
            JSON.stringify({
                posts: results,
                next: nextCursor,
            }),
            { status: 200 },
        );
    }

    /**
     * Handle a request for an account update
     */
    @APIRoute('PUT', 'account')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleUpdateAccount(ctx: AppContext) {
        const schema = z.object({
            name: z.string(),
            bio: z.string(),
            username: z.string(),
            avatarUrl: z.string(),
            bannerImageUrl: z.string(),
        });

        const account = await this.accountService.getAccountForSite(
            ctx.get('site'),
        );

        if (!account) {
            return new Response(null, { status: 404 });
        }

        let data: z.infer<typeof schema>;

        try {
            data = schema.parse((await ctx.req.json()) as unknown);
        } catch (err) {
            console.error(err);
            return new Response(JSON.stringify({}), { status: 400 });
        }

        await this.accountService.updateAccountProfile(account, {
            name: data.name,
            bio: data.bio,
            username: data.username,
            avatarUrl: data.avatarUrl,
            bannerImageUrl: data.bannerImageUrl,
        });

        return new Response(JSON.stringify({}), { status: 200 });
    }

    @APIRoute('GET', 'aliases')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleGetAccountAliases(ctx: AppContext) {
        const account = await this.accountService.getAccountForSite(
            ctx.get('site'),
        );

        if (!account) {
            return new Response(null, { status: 404 });
        }

        return new Response(
            JSON.stringify(await this.accountAliasesResponse(account)),
            {
                headers: {
                    'Content-Type': 'application/json',
                },
                status: 200,
            },
        );
    }

    @APIRoute('GET', 'domain')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleGetAccountDomain(ctx: AppContext) {
        const account = await this.accountService.getAccountForSite(
            ctx.get('site'),
        );

        if (!account) {
            return new Response(null, { status: 404 });
        }

        return new Response(
            JSON.stringify(this.accountDomainResponse(account)),
            {
                headers: {
                    'Content-Type': 'application/json',
                },
                status: 200,
            },
        );
    }

    @APIRoute('PUT', 'domain')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleUpdateAccountDomain(ctx: AppContext) {
        const account = await this.accountService.getAccountForSite(
            ctx.get('site'),
        );

        if (!account) {
            return new Response(null, { status: 404 });
        }

        let data: z.infer<typeof UpdateDomainSchema>;

        try {
            data = UpdateDomainSchema.parse((await ctx.req.json()) as unknown);
        } catch (_err) {
            return new Response(null, { status: 400 });
        }

        const result = await this.accountService.setWebfingerHost(
            account,
            data.domain,
        );

        if (isError(result)) {
            const accountError = getError(result);

            switch (accountError.type) {
                case 'invalid-domain':
                case 'invalid-webfinger':
                    return new Response(
                        JSON.stringify({ code: accountError.type }),
                        {
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            status: 400,
                        },
                    );
                case 'conflict':
                    return new Response(
                        JSON.stringify({ code: accountError.type }),
                        {
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            status: 409,
                        },
                    );
                case 'not-reachable':
                case 'wrong-actor':
                    return new Response(
                        JSON.stringify({ code: accountError.type }),
                        {
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            status: 422,
                        },
                    );
                default:
                    return exhaustiveCheck(accountError);
            }
        }

        return new Response(
            JSON.stringify(this.accountDomainResponse(getValue(result))),
            {
                headers: {
                    'Content-Type': 'application/json',
                },
                status: 200,
            },
        );
    }

    @APIRoute('POST', 'aliases')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleAddAccountAlias(ctx: AppContext) {
        const account = await this.accountService.getAccountForSite(
            ctx.get('site'),
        );

        if (!account) {
            return new Response(null, { status: 404 });
        }

        let data: z.infer<typeof AddAliasSchema>;

        try {
            data = AddAliasSchema.parse((await ctx.req.json()) as unknown);
        } catch (_err) {
            return new Response(null, { status: 400 });
        }

        const result = await this.accountService.addAlias(
            account,
            data.sourceHandle,
        );

        if (isError(result)) {
            const error = getError(result);
            switch (error) {
                case 'invalid-handle':
                case 'self-alias':
                    return new Response(null, { status: 400 });
                case 'lookup-failed':
                case 'not-an-actor':
                    return new Response(null, { status: 404 });
                case 'invalid-actor-uri':
                    return new Response(null, { status: 400 });
                default:
                    return exhaustiveCheck(error);
            }
        }

        return new Response(
            JSON.stringify(await this.accountAliasesResponse(account)),
            {
                headers: {
                    'Content-Type': 'application/json',
                },
                status: 200,
            },
        );
    }

    @APIRoute('DELETE', 'aliases')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleRemoveAccountAlias(ctx: AppContext) {
        const account = await this.accountService.getAccountForSite(
            ctx.get('site'),
        );

        if (!account) {
            return new Response(null, { status: 404 });
        }

        let data: z.infer<typeof RemoveAliasSchema>;

        try {
            data = RemoveAliasSchema.parse((await ctx.req.json()) as unknown);
        } catch (_err) {
            return new Response(null, { status: 400 });
        }

        const result = await this.accountService.removeAlias(
            account,
            data.actorUri,
        );

        if (isError(result)) {
            const error = getError(result);
            switch (error) {
                case 'invalid-actor-uri':
                    return new Response(null, { status: 400 });
                case 'lookup-failed':
                case 'not-an-actor':
                    return new Response(null, { status: 404 });
                case 'invalid-handle':
                case 'self-alias':
                    return new Response(null, { status: 400 });
                default:
                    return exhaustiveCheck(error);
            }
        }

        return new Response(
            JSON.stringify(await this.accountAliasesResponse(account)),
            {
                headers: {
                    'Content-Type': 'application/json',
                },
                status: 200,
            },
        );
    }
}

/**
 * Validates and extracts pagination parameters from the request
 *
 * @param ctx App context
 * @returns Object containing cursor and limit, or null if invalid
 */
function validateRequestParams(ctx: AppContext) {
    const queryCursor = ctx.req.query('next');
    const cursor = queryCursor ? decodeURIComponent(queryCursor) : null;

    const queryLimit = ctx.req.query('limit');
    const limit = queryLimit ? Number(queryLimit) : DEFAULT_POSTS_LIMIT;

    if (limit > MAX_POSTS_LIMIT) {
        return null;
    }

    return { cursor, limit };
}
