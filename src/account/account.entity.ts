import { randomUUID } from 'node:crypto';
import { BaseEntity } from '../core/base.entity';
import { type CreatePostType, PostType } from '../post/post.entity';
import type { Site } from '../site/site.service';

export interface AccountData {
    id: number;
    uuid: string | null;
    username: string;
    name: string | null;
    bio: string | null;
    avatarUrl: URL | null;
    bannerImageUrl: URL | null;
    site: Site | null;
    apId: URL | null;
    url: URL | null;
}

export class Account extends BaseEntity {
    public readonly uuid: string;
    public readonly url: URL;
    public readonly apId: URL;
    constructor(
        public readonly id: number | null,
        uuid: string | null,
        public readonly username: string,
        public readonly name: string | null,
        public readonly bio: string | null,
        public readonly avatarUrl: URL | null,
        public readonly bannerImageUrl: URL | null,
        private readonly site: Site | null,
        apId: URL | null,
        url: URL | null,
    ) {
        super(id);
        if (uuid === null) {
            this.uuid = randomUUID();
        } else {
            this.uuid = uuid;
        }
        if (apId === null) {
            this.apId = this.getApId();
        } else {
            this.apId = apId;
        }
        if (url === null) {
            this.url = this.apId;
        } else {
            this.url = url;
        }
    }

    get isInternal() {
        return this.site !== null;
    }

    getApId() {
        if (!this.isInternal) {
            throw new Error('Cannot get AP ID for External Accounts');
        }

        return new URL(
            `.ghost/activitypub/users/${this.username}`,
            `https://${this.site!.host}`,
        );
    }

    getApIdForPost(post: { type: CreatePostType; uuid: string }) {
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
            data.uuid,
            data.username,
            data.name,
            data.bio,
            data.avatarUrl,
            data.bannerImageUrl,
            data.site,
            data.apId,
            data.url,
        );
    }
}
