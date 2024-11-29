import { type Actor, type KvStore, PropertyValue } from '@fedify/fedify';

interface Attachment {
    name: string;
    value: string;
}

export async function getAttachments(
    actor: Actor,
    options?: {
        sanitizeValue?: (content: string) => string;
    },
): Promise<Attachment[]> {
    const attachments: Attachment[] = [];

    for await (const attachment of actor.getAttachments()) {
        if (!(attachment instanceof PropertyValue)) {
            continue;
        }

        const name = attachment.name?.toString() || '';
        let value = attachment.value?.toString() || '';

        if (options?.sanitizeValue) {
            value = options.sanitizeValue(value);
        }

        attachments.push({ name, value });
    }

    return attachments;
}

export async function getFollowerCount(actor: Actor): Promise<number> {
    const followers = await actor.getFollowers();

    return followers?.totalItems || 0;
}

export async function getFollowingCount(actor: Actor): Promise<number> {
    const following = await actor.getFollowing();

    return following?.totalItems || 0;
}

export function getHandle(actor: Actor): string {
    const host = actor.id?.host || 'unknown';

    return `@${actor?.preferredUsername || 'unknown'}@${host}`;
}

export async function isFollowing(
    actor: Actor,
    options: {
        db: KvStore;
    },
): Promise<boolean> {
    const following = (await options.db.get<string[]>(['following'])) || [];

    return actor.id?.href ? following.includes(actor.id.href) : false;
}

export function isHandle(handle: string): boolean {
    return /^@([\w-]+)@([\w-]+\.[\w.-]+)$/.test(handle);
}
