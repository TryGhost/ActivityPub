import { type Actor, isActor, type Update } from '@fedify/fedify';

import type { AccountService } from '@/account/account.service';
import { mapActorToExternalAccountData } from '@/account/utils';
import type { FedifyContext } from '@/app';
import { exhaustiveCheck, getError, isError } from '@/core/result';

export class UpdateHandler {
    constructor(private readonly accountService: AccountService) {}

    async handle(ctx: FedifyContext, update: Update) {
        ctx.data.logger.debug('Handling Update');

        if (!update.id) {
            ctx.data.logger.debug('Update missing id - exit');
            return;
        }

        const object = await update.getObject();
        if (!isActor(object)) {
            ctx.data.logger.debug('Update object is not an actor - exit');
            return;
        }

        const updatedActor = object as Actor;

        if (!updatedActor.id) {
            ctx.data.logger.debug('Update actor missing id - exit');
            return;
        }

        const accountData = await mapActorToExternalAccountData(updatedActor);

        const updateResult = await this.accountService.updateAccountByApId(
            updatedActor.id,
            {
                name: accountData.name,
                bio: accountData.bio,
                username: accountData.username,
                avatarUrl: accountData.avatar_url,
                bannerImageUrl: accountData.banner_image_url,
                url: accountData.url,
                customFields: accountData.custom_fields,
            },
        );

        if (isError(updateResult)) {
            const error = getError(updateResult);
            switch (error) {
                case 'account-not-found':
                    ctx.data.logger.debug(
                        'Update failed - account not found for apId',
                        {
                            apId: updatedActor.id,
                        },
                    );
                    return;
                default:
                    return exhaustiveCheck(error);
            }
        }
    }
}
