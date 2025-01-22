import { describe, expect, it, vi } from 'vitest';

import { type Actor, PropertyValue } from '@fedify/fedify';

import { mapActorToExternalAccountData } from './utils';

describe('mapActorToExternalAccountData', () => {
    it('should map actor to external account data', async () => {
        const actor = {
            id: new URL('https://example.com/actor/example'),
            preferredUsername: 'example',
            name: 'Example',
            summary: 'This is an example',
            getIcon: vi.fn().mockResolvedValue({
                url: new URL('https://example.com/icon/example'),
            }),
            getImage: vi.fn().mockResolvedValue({
                url: new URL('https://example.com/image/example'),
            }),
            url: new URL('https://example.com/actor/example'),
            getAttachments: vi.fn().mockImplementation(async function* () {
                yield new PropertyValue({ name: 'foo', value: 'bar' });
                yield new PropertyValue({ name: 'baz', value: 'qux' });
            }),
            inboxId: new URL('https://example.com/inbox/example'),
            endpoints: {
                sharedInbox: new URL('https://example.com/shared-inbox'),
            },
            outboxId: new URL('https://example.com/outbox/example'),
            followingId: new URL('https://example.com/following/example'),
            followersId: new URL('https://example.com/followers/example'),
            likedId: new URL('https://example.com/liked/example'),
            getPublicKey: vi.fn().mockResolvedValue({
                toJsonLd: vi.fn().mockResolvedValue({
                    id: 'https://example.com/public-key/example',
                    owner: 'https://example.com/actor/example',
                    publicKeyPem: 'publicKeyPem',
                }),
            }),
        } as unknown as Actor;

        const result = await mapActorToExternalAccountData(actor);

        expect(result).toMatchObject({
            username: 'example',
            name: 'Example',
            bio: 'This is an example',
            avatar_url: 'https://example.com/icon/example',
            banner_image_url: 'https://example.com/image/example',
            url: 'https://example.com/actor/example',
            custom_fields: {
                foo: 'bar',
                baz: 'qux',
            },
            ap_id: 'https://example.com/actor/example',
            ap_inbox_url: 'https://example.com/inbox/example',
            ap_shared_inbox_url: 'https://example.com/shared-inbox',
            ap_outbox_url: 'https://example.com/outbox/example',
            ap_following_url: 'https://example.com/following/example',
            ap_followers_url: 'https://example.com/followers/example',
            ap_liked_url: 'https://example.com/liked/example',
            ap_public_key: JSON.stringify({
                id: 'https://example.com/public-key/example',
                owner: 'https://example.com/actor/example',
                publicKeyPem: 'publicKeyPem',
            }),
        });
    });
});
