import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Context as HonoContext } from 'hono';

import type { Account } from '@/account/account.entity';
import type { KnexAccountRepository } from '@/account/account.repository.knex';
import { AtprotoDidController } from '@/http/api/atproto-did.controller';
import type { BlueskyService } from '@/integration/bluesky.service';
import type { Site, SiteService } from '@/site/site.service';

describe('AtprotoDidController', () => {
    const did = 'did:plc:bridged';

    let siteService: SiteService;
    let accountRepository: KnexAccountRepository;
    let blueskyService: BlueskyService;
    let controller: AtprotoDidController;

    const sites: Record<string, Site> = {
        'www.example.com': { id: 1, host: 'www.example.com' } as Site,
        'blog.example.org': { id: 2, host: 'blog.example.org' } as Site,
    };

    const accounts: Record<number, Account> = {
        1: { id: 11 } as Account,
        2: { id: 22 } as Account,
    };

    function ctxForHost(host?: string) {
        return {
            req: {
                header: (name: string) => (name === 'host' ? host : undefined),
            },
        } as unknown as HonoContext;
    }

    beforeEach(() => {
        siteService = {
            getSiteByHost: vi.fn(async (host: string) => sites[host] ?? null),
        } as unknown as SiteService;

        accountRepository = {
            getBySite: vi.fn(async (site: Site) => accounts[site.id] ?? null),
        } as unknown as KnexAccountRepository;

        blueskyService = {
            getDomainHandleDid: vi.fn(async (account: Account) =>
                account.id === 11 ? did : null,
            ),
        } as unknown as BlueskyService;

        controller = new AtprotoDidController(
            siteService,
            accountRepository,
            blueskyService,
        );
    });

    it('serves the DID of the site on the requested host', async () => {
        const response = await controller.handleGetAtprotoDid(
            ctxForHost('www.example.com'),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('text/plain');
        expect(await response.text()).toBe(did);
    });

    it('serves the DID of the www site for the root domain', async () => {
        const response = await controller.handleGetAtprotoDid(
            ctxForHost('example.com'),
        );

        expect(siteService.getSiteByHost).toHaveBeenCalledWith('example.com');
        expect(siteService.getSiteByHost).toHaveBeenCalledWith(
            'www.example.com',
        );
        expect(await response.text()).toBe(did);
    });

    it('ignores the case of the host', async () => {
        const response = await controller.handleGetAtprotoDid(
            ctxForHost('WWW.Example.com'),
        );

        expect(await response.text()).toBe(did);
    });

    it('returns 404 when the site has not claimed a domain handle', async () => {
        const response = await controller.handleGetAtprotoDid(
            ctxForHost('blog.example.org'),
        );

        expect(response.status).toBe(404);
    });

    it('returns 404 for an unknown host', async () => {
        const response = await controller.handleGetAtprotoDid(
            ctxForHost('unknown.example.net'),
        );

        expect(response.status).toBe(404);
        expect(blueskyService.getDomainHandleDid).not.toHaveBeenCalled();
    });

    it('returns 404 without a host', async () => {
        const response = await controller.handleGetAtprotoDid(ctxForHost());

        expect(response.status).toBe(404);
    });
});
