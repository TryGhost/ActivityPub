import { Storage } from '@google-cloud/storage';
import type { Account } from 'account/account.entity';
import type { AccountService } from 'account/account.service';
import type { Context } from 'hono';
import { v4 as uuidv4 } from 'uuid';

export function createStorageHandler(accountService: AccountService) {
    /**
     * Handle an upload to GCloud Storage bucket
     */
    return async function handleUpload(ctx: Context) {
        const logger = ctx.get('logger');
        const storage = new Storage();
        const bucketName = process.env.GCP_BUCKET_NAME;

        if (!bucketName) {
            return new Response('Bucket name is not configured', {
                status: 400,
            });
        }

        const account = await accountService.getAccountForSite(ctx.get('site'));
        const storagePath = getStoragePath(account);

        const formData = await ctx.req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return new Response('No file provided', { status: 400 });
        }

        try {
            const bucket = storage.bucket(bucketName);

            await bucket.file(storagePath).save(file.stream(), {
                metadata: {
                    contentType: file.type,
                },
            });

            const fileUrl = `https://storage.googleapis.com/${bucketName}/${storagePath}`;

            return new Response(JSON.stringify({ fileUrl }), {
                status: 200,
            });
        } catch (err) {
            logger.error('Error uploading file:', err);
            return new Response(JSON.stringify({}), {
                status: 200,
            });
        }
    };

    function getStoragePath(account: Account) {
        return `images/${account.uuid}/${uuidv4()}`;
    }
}
