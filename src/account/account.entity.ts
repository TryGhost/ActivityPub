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
    apFollowers: URL | null;
}

export type AccountSite = {
    id: number;
    host: string;
};

export interface ProfileUpdateParams {
    name?: string | null;
    bio?: string | null;
    username?: string;
    avatarUrl?: URL | null;
    bannerImageUrl?: URL | null;
}

export class Account extends BaseEntity {
    public readonly uuid: string;
    public readonly url: URL;
    public readonly apId: URL;
    public readonly apFollowers: URL;

    private _name: string | null;
    private _bio: string | null;
    private _username: string;
    private _avatarUrl: URL | null;
    private _bannerImageUrl: URL | null;

    constructor(
        public readonly id: number | null,
        uuid: string | null,
        username: string,
        name: string | null,
        bio: string | null,
        avatarUrl: URL | null,
        bannerImageUrl: URL | null,
        private readonly site: AccountSite | null,
        apId: URL | null,
        url: URL | null,
        apFollowers: URL | null,
    ) {
        super(id);

        this._name = name;
        this._bio = bio;
        this._username = username;
        this._avatarUrl = avatarUrl;
        this._bannerImageUrl = bannerImageUrl;

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
        if (apFollowers === null) {
            this.apFollowers = this.getApFollowers();
        } else {
            this.apFollowers = apFollowers;
        }
        if (url === null) {
            this.url = this.apId;
        } else {
            this.url = url;
        }
    }

    get name(): string | null {
        return this._name;
    }

    get bio(): string | null {
        return this._bio;
    }

    get username(): string {
        return this._username;
    }

    get avatarUrl(): URL | null {
        return this._avatarUrl;
    }

    get bannerImageUrl(): URL | null {
        return this._bannerImageUrl;
    }

    updateProfile(params: ProfileUpdateParams): void {
        if (params.name !== undefined) {
            this._name = params.name;
        }

        if (params.bio !== undefined) {
            this._bio = params.bio;
        }

        if (params.username !== undefined) {
            this._username = params.username;
        }

        if (params.avatarUrl !== undefined) {
            this._avatarUrl = params.avatarUrl;
        }

        if (params.bannerImageUrl !== undefined) {
            this._bannerImageUrl = params.bannerImageUrl;
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
            `${Account.protocol}://${this.site!.host}`,
        );
    }

    getApFollowers() {
        if (!this.isInternal) {
            throw new Error('Cannot get AP Followers for External Accounts');
        }

        return new URL(
            `.ghost/activitypub/followers/${this.username}`,
            `${Account.protocol}://${this.site!.host}`,
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
            `${Account.protocol}://${this.site!.host}`,
        );
    }

    private static protocol: 'http' | 'https' =
        process.env.NODE_ENV === 'testing' ? 'http' : 'https';

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
            data.apFollowers,
        );
    }
}
