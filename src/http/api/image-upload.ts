import type { AccountService } from 'account/account.service';
import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
import type { Context } from 'hono';
import type { ImageStorageService } from 'storage/image-storage.service';

export function createImageUploadHandler(
    accountService: AccountService,
    imageStorageService: ImageStorageService,
) {
    return async function handleImageUpload(ctx: Context) {
        const logger = ctx.get('logger');
        const formData = await ctx.req.formData();
        const file = formData.get('file');

        if (!file || !(file instanceof File)) {
            return new Response('No valid file provided', { status: 400 });
        }

        const account = await accountService.getAccountForSite(ctx.get('site'));
        const result = await imageStorageService.save(
            file,
            `images/${account.uuid}/`,
        );

        if (isError(result)) {
            const error = getError(result);
            switch (error) {
                case 'file-too-large':
                    logger.error(`File is too large: ${file.size} bytes`);
                    return new Response('File is too large', { status: 413 });
                case 'file-type-not-supported':
                    logger.error(`File type ${file.type} is not supported`);
                    return new Response(
                        `File type ${file.type} is not supported`,
                        { status: 415 },
                    );
                case 'error-saving-file':
                    return new Response(
                        'Failed to save file, please try again later',
                        { status: 500 },
                    );
                default:
                    exhaustiveCheck(error);
            }
        }

        const fileUrl = getValue(result);
        return new Response(JSON.stringify({ fileUrl }), {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    };
}
