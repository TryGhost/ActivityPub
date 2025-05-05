import type { AccountService } from 'account/account.service';
import type { AppContext } from 'app';
import { exhaustiveCheck, getError, isError } from 'core/result';
import { parseURL } from 'core/url';
import { BadRequest, NotFound } from './helpers/response';

export class BlockController {
    constructor(private readonly accountService: AccountService) {}

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
}
