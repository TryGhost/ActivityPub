import {
    type Actor,
    Image,
    type KvStore,
    PUBLIC_COLLECTION,
    PropertyValue,
    type RequestContext,
    Update,
} from '@fedify/fedify';
import { v4 as uuidv4 } from 'uuid';
import type { ContextData } from '../../app';
import { ACTOR_DEFAULT_HANDLE } from '../../constants';
import { type UserData, getUserData, setUserData } from '../user';

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

export async function updateSiteActor(
    apCtx: RequestContext<ContextData>,
    getSiteSettings: (host: string) => Promise<{
        site: { icon: string; title: string; description: string };
    }>,
) {
    const settings = await getSiteSettings(apCtx.host);
    const handle = ACTOR_DEFAULT_HANDLE;

    const current = await getUserData(apCtx, handle);

    if (
        current &&
        current.icon.url?.toString() === settings.site.icon &&
        current.name === settings.site.title &&
        current.summary === settings.site.description
    ) {
        apCtx.data.logger.info(
            'No site settings changed, not updating site actor',
        );
        return false;
    }

    const updated: UserData = {
        ...current,
    };

    try {
        updated.icon = new Image({ url: new URL(settings.site.icon) });
    } catch (err) {
        apCtx.data.logger.error(
            'Could not create Image from Icon value ({icon}): {error}',
            { icon: settings.site.icon, error: err },
        );
    }

    updated.name = settings.site.title;
    updated.summary = settings.site.description;

    await setUserData(apCtx, updated, handle);

    apCtx.data.logger.info('Site settings changed, will notify followers');

    const actor = await apCtx.getActor(handle);

    const update = new Update({
        id: apCtx.getObjectUri(Update, { id: uuidv4() }),
        actor: actor?.id,
        to: PUBLIC_COLLECTION,
        object: actor?.id,
        cc: apCtx.getFollowersUri('index'),
    });

    await apCtx.data.globaldb.set([update.id!.href], await update.toJsonLd());

    await apCtx.sendActivity({ handle }, 'followers', update, {
        preferSharedInbox: true,
    });

    return true;
}
