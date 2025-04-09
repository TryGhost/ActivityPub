import { describe, expect, it, vi } from 'vitest';

import type { Activity, Actor } from '@fedify/fedify';

import type { FedifyRequestContext } from '../app';

import { FedifyActivitySender } from './activity';

describe('FedifyActivitySender', () => {
    describe('sendActivityToActorFollowers', () => {
        it('should send an Activity to the followers of an Actor', async () => {
            const handle = 'foo';

            const mockActor = {
                preferredUsername: handle,
            } as Actor;
            const mockActivity = {} as Activity;
            const mockFedifyCtx = {
                sendActivity: vi.fn(),
            } as unknown as FedifyRequestContext;

            const sender = new FedifyActivitySender(mockFedifyCtx);

            await sender.sendActivityToActorFollowers(mockActivity, mockActor);

            expect(mockFedifyCtx.sendActivity).toHaveBeenCalledWith(
                { handle },
                'followers',
                mockActivity,
                {
                    preferSharedInbox: true,
                },
            );
        });
    });
});
