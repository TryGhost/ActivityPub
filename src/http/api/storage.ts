import type { AccountService } from 'account/account.service';
import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
import type { Context } from 'hono';
import type { GCPStorageService } from 'storage/gcloud-storage/gcp-storage.service';

export function createStorageHandler(
    accountService: AccountService,
    storageService: GCPStorageService,
) {
    /**
     * Handle an upload to GCloud Storage bucket
     */
    return async function handleUpload(ctx: Context) {
        const logger = ctx.get('logger');
        const formData = await ctx.req.formData();
        const file = formData.get('file');

        if (!file || !(file instanceof File)) {
            return new Response('No valid file provided', { status: 400 });
        }

        const account = await accountService.getAccountForSite(ctx.get('site'));
        const result = await storageService.saveFile(file, account.uuid);

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
