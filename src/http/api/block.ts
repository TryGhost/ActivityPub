import type { AccountService } from 'account/account.service';
import type { AppContext } from 'app';
import { exhaustiveCheck, getError, isError } from 'core/result';
import { parseURL } from 'core/url';
import { BadRequest, NotFound } from './helpers/response';
import type { BlocksView } from './views/blocks.view';

export class BlockController {
    constructor(
        private readonly accountService: AccountService,
        private readonly blocksView: BlocksView,
    ) {}

    async handleBlock(ctx: AppContext) {
        const accountToBlock = parseURL(
            decodeURIComponent(ctx.req.param('id')),
        );

        if (!accountToBlock) {
            return BadRequest('Expected a URL for the ID');
        }

        const result = await this.accountService.blockAccountByApId(
            ctx.get('account'),
            accountToBlock,
        );

        if (isError(result)) {
            const error = getError(result);
            switch (error) {
                case 'not-found':
                    return NotFound('Remote account could not be found');
                case 'invalid-type':
                    return BadRequest('Remote account is not an Actor');
                case 'invalid-data':
                    return BadRequest('Remote account could not be parsed');
                case 'network-failure':
                    return NotFound('Remote account could not be fetched');
                default:
                    return exhaustiveCheck(error);
            }
        }

        return new Response(null, {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 201,
        });
    }

    async handleUnblock(ctx: AppContext) {
        const accountToUnblock = parseURL(
            decodeURIComponent(ctx.req.param('id')),
        );

        if (!accountToUnblock) {
            return BadRequest('Expected a URL for the ID');
        }

        const result = await this.accountService.unblockAccountByApId(
            ctx.get('account'),
            accountToUnblock,
        );

        if (isError(result)) {
            const error = getError(result);
            switch (error) {
                case 'not-found':
                    return NotFound('Remote account could not be found');
                case 'invalid-type':
                    return BadRequest('Remote account is not an Actor');
                case 'invalid-data':
                    return BadRequest('Remote account could not be parsed');
                case 'network-failure':
                    return NotFound('Remote account could not be fetched');
                default:
                    return exhaustiveCheck(error);
            }
        }

        return new Response(null, {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    }

    async handleBlockDomain(ctx: AppContext) {
        const domain = parseURL(decodeURIComponent(ctx.req.param('domain')));
        if (!domain) {
            return BadRequest('Expected a URL for the domain');
        }

        await this.accountService.blockDomain(ctx.get('account'), domain);

        return new Response(null, {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 201,
        });
    }

    async handleUnblockDomain(ctx: AppContext) {
        const domain = parseURL(decodeURIComponent(ctx.req.param('domain')));
        if (!domain) {
            return BadRequest('Expected a URL for the domain');
        }

        await this.accountService.unblockDomain(ctx.get('account'), domain);

        return new Response(null, {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    }

    async handleGetBlockedAccounts(ctx: AppContext) {
        const account = ctx.get('account');
        const blockedAccounts = await this.blocksView.getBlockedAccounts(
            account.id,
        );

        return new Response(
            JSON.stringify({ blocked_accounts: blockedAccounts }),
            {
                headers: {
                    'Content-Type': 'application/json',
                },
                status: 200,
            },
        );
    }

    async handleGetBlockedDomains(ctx: AppContext) {
        const account = ctx.get('account');
        const blockedDomains = await this.blocksView.getBlockedDomains(
            account.id,
        );

        return new Response(
            JSON.stringify({ blocked_domains: blockedDomains }),
            {
                headers: {
                    'Content-Type': 'application/json',
                },
                status: 200,
            },
        );
    }
}
