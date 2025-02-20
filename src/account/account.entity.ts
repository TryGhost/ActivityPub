import { randomUUID } from 'node:crypto';
import { BaseEntity } from '../core/base.entity';
import { type Post, PostType } from '../post/post.entity';
import type { Site } from '../site/site.service';

export interface AccountData {
    id: number;
    username: string;
    name: string | null;
    bio: string | null;
    avatarUrl: URL | null;
    bannerImageUrl: URL | null;
    site: Site | null;
}

export class Account extends BaseEntity {
    public readonly uuid: string;

    constructor(
        public readonly id: number | null,
        uuid: string | null,
        public readonly username: string,
        public readonly name: string | null,
        public readonly bio: string | null,
        public readonly avatarUrl: URL | null,
        public readonly bannerImageUrl: URL | null,
        private readonly site: Site | null,
    ) {
        super(id);
        if (uuid === null) {
            this.uuid = randomUUID();
        } else {
            this.uuid = uuid;
        }
    }

    get isInternal() {
        return this.site !== null;
    }

    getApIdForPost(post: Post) {
        if (!this.isInternal) {
            throw new Error('Cannot get AP ID for External Accounts');
        }

        let type: string;
        switch (post.type) {
            case PostType.Article:
                type = 'article';
                break;
            case PostType.Note:
                type = 'note';
                break;
            default: {
                const exhaustiveCheck: never = post.type;
                throw new Error(`Forgot to handle ${exhaustiveCheck}`);
            }
        }

        return new URL(
            `.ghost/activitypub/${type}/${post.uuid}`,
            `https://${this.site!.host}`,
        );
    }

    static createFromData(data: AccountData) {
        return new Account(
            data.id,
            data.username,
            data.name,
            data.bio,
            data.avatarUrl,
            data.bannerImageUrl,
            data.site,
        );
    }
}
