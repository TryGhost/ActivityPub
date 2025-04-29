import type { AccountService } from 'account/account.service';
import type { AppContext } from 'app';
import { exhaustiveCheck, getError, isError } from 'core/result';
import { parseURL } from 'core/url';

const NotFound = (message: string) =>
    new Response(JSON.stringify({ message }), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 404,
    });

const BadRequest = (message: string) =>
    new Response(JSON.stringify({ message }), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 400,
    });

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
}
