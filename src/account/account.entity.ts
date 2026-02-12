import { randomUUID } from 'node:crypto';

import {
    AccountBlockedEvent,
    AccountCreatedEvent,
    AccountFollowedEvent,
    AccountUnblockedEvent,
    AccountUnfollowedEvent,
    AccountUpdatedEvent,
    DomainBlockedEvent,
    DomainUnblockedEvent,
    NotificationsReadEvent,
} from '@/account/events';
import { type CreatePostType, PostType } from '@/post/post.entity';

export interface Account {
    readonly id: number;
    readonly uuid: string;
    readonly username: string;
    readonly name: string | null;
    readonly bio: string | null;
    readonly url: URL;
    readonly avatarUrl: URL | null;
    readonly bannerImageUrl: URL | null;
    readonly apId: URL;
    readonly apFollowers: URL | null;
    readonly apInbox: URL | null;
    readonly apOutbox: URL | null;
    readonly apFollowing: URL | null;
    readonly apLiked: URL | null;
    readonly isInternal: boolean;
    readonly customFields: Record<string, string> | null;
    unblock(account: Account): Account;
    block(account: Account): Account;
    blockDomain(domain: URL): Account;
    unblockDomain(domain: URL): Account;
    follow(account: Account): Account;
    unfollow(account: Account): Account;
    readAllNotifications(): Account;
    /**
     * Returns a new Account instance which needs to be saved.
     */
    updateProfile(params: ProfileUpdateParams): Account;
    /**
     * @deprecated
     */
    getApIdForPost(post: { type: CreatePostType; uuid: string }): URL;
}

export interface AccountDraft {
    uuid: string;
    username: string;
    name: string | null;
    bio: string | null;
    url: URL;
    avatarUrl: URL | null;
    bannerImageUrl: URL | null;
    apId: URL;
    customFields: Record<string, string> | null;
    apFollowers: URL | null;
    apFollowing: URL | null;
    apInbox: URL | null;
    apSharedInbox: URL | null;
    apOutbox: URL | null;
    apLiked: URL | null;
    apPublicKey: CryptoKey;
    apPrivateKey: CryptoKey | null;
    isInternal: boolean;
}

export type AccountEvent = {
    getName(): string;
};

export class AccountEntity implements Account {
    constructor(
        public readonly id: number,
        public readonly uuid: string,
        public readonly username: string,
        public readonly name: string | null,
        public readonly bio: string | null,
        public readonly url: URL,
        public readonly avatarUrl: URL | null,
        public readonly bannerImageUrl: URL | null,
        public readonly apId: URL,
        public readonly apFollowers: URL | null,
        public readonly apInbox: URL | null,
        public readonly apOutbox: URL | null,
        public readonly apFollowing: URL | null,
        public readonly apLiked: URL | null,
        public readonly isInternal: boolean,
        public readonly customFields: Record<string, string> | null,
        private events: AccountEvent[],
    ) {}

    static pullEvents(account: Account): AccountEvent[] {
        if (account instanceof AccountEntity) {
            const events = account.events;
            account.events = [];
            return events;
        }
        return [];
    }

    static create(data: Data<Account>, events: AccountEvent[] = []) {
        return new AccountEntity(
            data.id,
            data.uuid,
            data.username,
            data.name,
            data.bio,
            data.url,
            data.avatarUrl,
            data.bannerImageUrl,
            data.apId,
            data.apFollowers,
            data.apInbox,
            data.apOutbox,
            data.apFollowing,
            data.apLiked,
            data.isInternal,
            data.customFields,
            events,
        );
    }

    static fromDraft(draft: AccountDraft, id: number): AccountEntity {
        const events: AccountEvent[] = [new AccountCreatedEvent(id)];
        return new AccountEntity(
            id,
            draft.uuid,
            draft.username,
            draft.name,
            draft.bio,
            draft.url,
            draft.avatarUrl,
            draft.bannerImageUrl,
            draft.apId,
            draft.apFollowers,
            draft.apInbox,
            draft.apOutbox,
            draft.apFollowing,
            draft.apLiked,
            draft.isInternal,
            draft.customFields,
            events,
        );
    }

    static draft(from: AccountDraftData): AccountDraft {
        const uuid = randomUUID();
        const apId = !from.isInternal
            ? from.apId
            : new URL('/.ghost/activitypub/users/index', from.host);
        const apFollowers = !from.isInternal
            ? from.apFollowers
            : new URL('/.ghost/activitypub/followers/index', from.host);
        const apInbox = !from.isInternal
            ? from.apInbox
            : new URL('/.ghost/activitypub/inbox/index', from.host);
        const apSharedInbox = !from.isInternal ? from.apSharedInbox : null;
        const apOutbox = !from.isInternal
            ? from.apOutbox
            : new URL('/.ghost/activitypub/outbox/index', from.host);
        const apFollowing = !from.isInternal
            ? from.apFollowing
            : new URL('/.ghost/activitypub/following/index', from.host);
        const apLiked = !from.isInternal
            ? from.apLiked
            : new URL('/.ghost/activitypub/liked/index', from.host);
        const url = from.url || apId;
        const apPrivateKey = !from.isInternal ? null : from.apPrivateKey;

        return {
            ...from,
            uuid,
            url,
            apId,
            apFollowers,
            apInbox,
            apSharedInbox,
            apOutbox,
            apFollowing,
            apLiked,
            apPrivateKey,
        };
    }

    getApIdForPost(post: { type: CreatePostType; uuid: string }): URL {
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

        return new URL(`/.ghost/activitypub/${type}/${post.uuid}`, this.apId);
    }

    updateProfile(params: ProfileUpdateParams): Account {
        type P = ProfileUpdateParams;
        const get = <K extends keyof P>(prop: K): P[K] =>
            params[prop] === undefined ? this[prop] : params[prop];

        const account = AccountEntity.create(
            {
                ...this,
                username: get('username'),
                name: get('name'),
                bio: get('bio'),
                avatarUrl: get('avatarUrl'),
                bannerImageUrl: get('bannerImageUrl'),
                url: get('url'),
                customFields: get('customFields'),
            },
            this.events,
        );

        if (
            account.username !== this.username ||
            account.name !== this.name ||
            account.bio !== this.bio ||
            account.avatarUrl?.href !== this.avatarUrl?.href ||
            account.bannerImageUrl?.href !== this.bannerImageUrl?.href ||
            account.url?.href !== this.url?.href ||
            account.customFields !== this.customFields
        ) {
            account.events = account.events.concat(
                new AccountUpdatedEvent(account.id),
            );
        }

        return account;
    }

    unblock(account: Account): Account {
        if (account.id === this.id) {
            return this;
        }
        return AccountEntity.create(
            this,
            this.events.concat(new AccountUnblockedEvent(account.id, this.id)),
        );
    }

    block(account: Account): Account {
        if (account.id === this.id) {
            return this;
        }
        return AccountEntity.create(
            this,
            this.events.concat(new AccountBlockedEvent(account.id, this.id)),
        );
    }

    blockDomain(domain: URL): Account {
        return AccountEntity.create(
            this,
            this.events.concat(new DomainBlockedEvent(domain, this.id)),
        );
    }

    unblockDomain(domain: URL): Account {
        return AccountEntity.create(
            this,
            this.events.concat(new DomainUnblockedEvent(domain, this.id)),
        );
    }

    follow(account: Account): Account {
        if (account.id === this.id) {
            return this;
        }
        return AccountEntity.create(
            this,
            this.events.concat(new AccountFollowedEvent(account.id, this.id)),
        );
    }

    unfollow(account: Account): Account {
        if (account.id === this.id) {
            return this;
        }
        return AccountEntity.create(
            this,
            this.events.concat(new AccountUnfollowedEvent(account.id, this.id)),
        );
    }

    readAllNotifications(): Account {
        return AccountEntity.create(
            this,
            this.events.concat(new NotificationsReadEvent(this.id)),
        );
    }
}

type ProfileUpdateParams = {
    name?: string | null;
    bio?: string | null;
    username?: string;
    avatarUrl?: URL | null;
    bannerImageUrl?: URL | null;
    url?: URL | null;
    customFields?: Record<string, string> | null;
};

/**
 * Internal accounts require a `host` so we can calculate the ActivityPub URLs
 */
type InternalAccountDraftData = {
    isInternal: true;
    host: URL;
    username: string;
    name: string;
    bio: string | null;
    url: URL | null;
    avatarUrl: URL | null;
    bannerImageUrl: URL | null;
    customFields: Record<string, string> | null;
    apPublicKey: CryptoKey;
    apPrivateKey: CryptoKey;
};

/**
 * External accounts require the ActivityPub URLs to be passed in
 */
type ExternalAccountDraftData = {
    isInternal: false;
    username: string;
    name: string;
    bio: string | null;
    url: URL | null;
    avatarUrl: URL | null;
    bannerImageUrl: URL | null;
    customFields: Record<string, string> | null;
    apId: URL;
    apFollowers: URL | null;
    apInbox: URL | null;
    apSharedInbox: URL | null;
    apOutbox: URL | null;
    apFollowing: URL | null;
    apLiked: URL | null;
    apPublicKey: CryptoKey;
};

type AccountDraftData = InternalAccountDraftData | ExternalAccountDraftData;

type Data<T> = {
    // biome-ignore lint/suspicious/noExplicitAny: These anys are internal and don't leak to our code
    [K in keyof T as T[K] extends (...args: any[]) => any ? never : K]: T[K];
};
