import { Actor, KvStore, PropertyValue, } from "@fedify/fedify";

interface Attachment {
    name: string;
    value: string;
}

export async function getAttachments(actor: Actor, options?: {
    sanitizeValue?: (content: string) => string;
}): Promise<Attachment[]> {
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

export function getHandle(actor: Actor): string {
    const host = actor.id?.host || 'unknown';

    return `@${actor?.preferredUsername || 'unknown'}@${host}`;
}

export async function getRecentActivities(actor: Actor, options?: {
    sanitizeContent?: (content: string) => string;
}): Promise<unknown[]> {
    const activities: unknown[] = [];
    const outbox = await actor.getOutbox();

    if (!outbox) {
        return [];
    }

    const firstPage = await outbox.getFirst();

    if (!firstPage) {
        return [];
    }

    for await (const activity of firstPage.getItems()) {
        const activityJson = await activity.toJsonLd({ format: 'compact' }) as { content: string };

        if (options?.sanitizeContent) {
            activityJson.content = options.sanitizeContent(activityJson.content);
        }

        activities.push(activityJson);
    }

    return activities;
}

export async function isFollowing(actor: Actor, options: {
    db: KvStore;
}): Promise<boolean> {
    const following = (
        await options.db.get<string[]>(['following'])
    ) || [];

    return actor.id?.href
        ? following.includes(actor.id.href)
        : false;
}

export function isHandle(handle: string): boolean {
    return /^@([\w-]+)@([\w-]+\.[\w.-]+)$/.test(handle);
}
