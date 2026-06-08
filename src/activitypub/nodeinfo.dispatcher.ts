import { type Protocol } from '@fedify/fedify';

import type { Account } from '@/account/account.entity';
import type {
    NodeInfoData,
    NodeInfoService,
} from '@/activitypub/nodeinfo.service';
import type { FedifyRequestContext } from '@/app';
import { getError, getValue, isError } from '@/core/result';
import type { HostDataContextLoader } from '@/http/host-data-context-loader';

export class NodeInfoDispatcher {
    constructor(
        private readonly hostDataContextLoader: HostDataContextLoader,
        private readonly nodeInfoService: NodeInfoService,
    ) {}

    async dispatch(ctx: FedifyRequestContext) {
        const hostData = await this.hostDataContextLoader.loadDataForHost(
            ctx.host,
        );

        if (isError(hostData)) {
            ctx.data.logger.error('NodeInfo: failed to resolve host', {
                host: ctx.host,
                error: getError(hostData),
            });
            throw new Error('NodeInfo requested without site context');
        }

        const { site, account } = getValue(hostData);
        const data = await this.nodeInfoService.getData(site, account);

        return {
            software: {
                name: 'ghost' as const,
                version: { major: 0, minor: 1, patch: 0 },
                homepage: new URL('https://ghost.org/'),
                repository: new URL('https://github.com/TryGhost/Ghost'),
            },
            protocols: ['activitypub'] satisfies Protocol[],
            services: {
                inbound: [],
                outbound: [],
            },
            openRegistrations: false,
            usage: {
                users: {
                    total: 1,
                    activeMonth: this.isActiveWithin(data.lastActivityAt, 30),
                    activeHalfyear: this.isActiveWithin(
                        data.lastActivityAt,
                        180,
                    ),
                },
                localPosts: data.localPosts,
                localComments: data.localComments,
            },
            metadata: this.getMetadata(account),
        };
    }

    private isActiveWithin(
        lastActivityAt: NodeInfoData['lastActivityAt'],
        days: number,
    ): 0 | 1 {
        if (lastActivityAt === null) {
            return 0;
        }

        const activeSince = Date.now() - days * 24 * 60 * 60 * 1000;

        return lastActivityAt.getTime() >= activeSince ? 1 : 0;
    }

    private getMetadata(account: Account) {
        return {
            nodeName: account.name ?? account.url.hostname,
            ...(account.bio ? { nodeDescription: account.bio } : {}),
            ...(account.avatarUrl ? { nodeIcon: account.avatarUrl.href } : {}),
            ...(account.bannerImageUrl
                ? { nodeBanner: account.bannerImageUrl.href }
                : {}),
            private: false,
            postFormats: ['text/html'],
        };
    }
}
