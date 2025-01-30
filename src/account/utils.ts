import { type Actor, PropertyValue } from '@fedify/fedify';
import type { ExternalAccountData } from './types';

interface PublicKey {
    id: string;
    owner: string;
    publicKeyPem: string;
}

/**
 * Map a Fedify Actor to an external account data object
 *
 * @param actor Actor
 */
export async function mapActorToExternalAccountData(
    actor: Actor,
): Promise<ExternalAccountData> {
    const customFields: Record<string, string> = {};

    for await (const attachment of actor.getAttachments()) {
        if (!(attachment instanceof PropertyValue)) {
            continue;
        }

        const name = attachment.name?.toString() || '';
        const value = attachment.value?.toString() || '';

        if (name && value) {
            customFields[name] = value;
        }
    }

    let apPublicKey: PublicKey | null = null;

    const publicKey = await actor.getPublicKey();

    if (publicKey) {
        const jsonLd = (await publicKey.toJsonLd({
            format: 'compact',
        })) as Partial<PublicKey>;

        if (typeof jsonLd === 'object' && jsonLd !== null) {
            apPublicKey = {
                id: jsonLd.id ?? '',
                owner: jsonLd.owner ?? '',
                publicKeyPem: jsonLd.publicKeyPem ?? '',
            };
        }
    }

    return {
        username: actor.preferredUsername?.toString() ?? '',
        name: actor.name?.toString() ?? null,
        bio: actor.summary?.toString() ?? null,
        avatar_url: (await actor.getIcon())?.url?.toString() ?? null,
        banner_image_url: (await actor.getImage())?.url?.toString() ?? null,
        url: actor.url?.toString() ?? null,
        custom_fields:
            Object.keys(customFields).length > 0 ? customFields : null,
        ap_id: actor.id?.href ?? '',
        ap_inbox_url: actor.inboxId?.href ?? '',
        ap_shared_inbox_url: actor.endpoints?.sharedInbox?.href ?? null,
        ap_outbox_url: actor.outboxId?.href ?? '',
        ap_following_url: actor.followingId?.href ?? '',
        ap_followers_url: actor.followersId?.href ?? '',
        ap_liked_url: actor.likedId?.href ?? '',
        ap_public_key: apPublicKey ? JSON.stringify(apPublicKey) : '',
    };
}

/**
 * Compute the handle for an account from the provided host and username
 *
 * @param host Host of the site the account belongs to
 * @param username Username of the account
 */
export function getAccountHandle(host?: string, username?: string) {
    return `@${username || 'unknown'}@${host || 'unknown'}`;
}
