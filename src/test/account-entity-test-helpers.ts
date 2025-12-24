import { AccountEntity } from '@/account/account.entity';
import { generateTestCryptoKeyPair } from '@/test/crypto-key-pair';

export async function createInternalAccountDraftData(overrides: {
    host: URL;
    username: string;
    name: string;
    bio: string | null;
    url: URL | null;
    avatarUrl: URL | null;
    bannerImageUrl: URL | null;
    customFields: Record<string, string> | null;
}) {
    const keyPairs = await generateTestCryptoKeyPair();

    return {
        isInternal: true as const,
        host: overrides.host,
        username: overrides.username,
        name: overrides.name,
        bio: overrides.bio,
        url: overrides.url,
        avatarUrl: overrides.avatarUrl,
        bannerImageUrl: overrides.bannerImageUrl,
        customFields: overrides.customFields,
        apPublicKey: keyPairs[0].publicKey,
        apPrivateKey: keyPairs[0].privateKey,
    };
}

export async function createExternalAccountDraftData(overrides: {
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
    apSharedInbox?: URL | null;
    apOutbox?: URL | null;
    apFollowing?: URL | null;
    apLiked?: URL | null;
}) {
    const keyPairs = await generateTestCryptoKeyPair();

    return {
        isInternal: false as const,
        username: overrides.username,
        name: overrides.name,
        bio: overrides.bio,
        url: overrides.url,
        avatarUrl: overrides.avatarUrl,
        bannerImageUrl: overrides.bannerImageUrl,
        customFields: overrides.customFields,
        apId: overrides.apId,
        apFollowers: overrides.apFollowers,
        apInbox: overrides.apInbox,
        apSharedInbox: overrides.apSharedInbox || null,
        apOutbox: overrides.apOutbox || null,
        apFollowing: overrides.apFollowing || null,
        apLiked: overrides.apLiked || null,
        apPublicKey: keyPairs[0].publicKey,
    };
}

// Helper functions that create full account entities
export async function createTestInternalAccount(
    id: number,
    overrides: {
        host: URL;
        username: string;
        name: string;
        bio: string | null;
        url: URL | null;
        avatarUrl: URL | null;
        bannerImageUrl: URL | null;
        customFields: Record<string, string> | null;
    },
) {
    const draftData = await createInternalAccountDraftData(overrides);
    const draft = AccountEntity.draft(draftData);

    return AccountEntity.create({
        id,
        ...draft,
    });
}

export async function createTestExternalAccount(
    id: number,
    overrides: {
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
        apSharedInbox?: URL | null;
        apOutbox?: URL | null;
        apFollowing?: URL | null;
        apLiked?: URL | null;
    },
) {
    const draftData = await createExternalAccountDraftData(overrides);
    const draft = AccountEntity.draft(draftData);

    return AccountEntity.create({
        id,
        ...draft,
    });
}
