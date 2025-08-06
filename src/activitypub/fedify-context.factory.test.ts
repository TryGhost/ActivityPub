import { describe, expect, it } from 'vitest';

import { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import type { FedifyContext } from '@/app';

describe('FedifyContextFactory', () => {
    it('Gives back the fedify context when called in the register callback', async () => {
        const context = {} as unknown as FedifyContext;

        const fedifyContextFactory = new FedifyContextFactory();

        await fedifyContextFactory.registerContext(context, async () => {
            const retrieved = fedifyContextFactory.getFedifyContext();
            expect(retrieved).toBe(context);
        });
    });
});
