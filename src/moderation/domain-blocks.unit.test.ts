import { describe, expect, it } from 'vitest';

import { isAccountDomainBlocked } from '@/moderation/domain-blocks';

describe('isAccountDomainBlocked', () => {
    it('matches the actor host', () => {
        const blocked = new Set(['john.onolan.org']);

        expect(isAccountDomainBlocked(blocked, 'john.onolan.org', null)).toBe(
            true,
        );
    });

    it('matches the custom handle host', () => {
        const blocked = new Set(['onolan.org']);

        expect(
            isAccountDomainBlocked(blocked, 'john.onolan.org', 'onolan.org'),
        ).toBe(true);
    });

    it('matches the URL a collection listed an actor under', () => {
        // `lookupObject` can redirect to a canonical actor id on another
        // domain, and the reader may have blocked either of them
        const blocked = new Set(['listed.example']);

        expect(
            isAccountDomainBlocked(
                blocked,
                'canonical.example',
                'listed.example',
            ),
        ).toBe(true);
    });

    it('ignores hosts that are not known', () => {
        const blocked = new Set(['onolan.org']);

        expect(
            isAccountDomainBlocked(blocked, 'john.onolan.org', null, undefined),
        ).toBe(false);
    });

    it('compares case insensitively', () => {
        const blocked = new Set(['onolan.org']);

        expect(isAccountDomainBlocked(blocked, 'ONOLAN.ORG')).toBe(true);
    });

    it('treats subdomains as distinct domains', () => {
        const blocked = new Set(['onolan.org']);

        expect(isAccountDomainBlocked(blocked, 'john.onolan.org')).toBe(false);
    });
});
