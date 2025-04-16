import { Storage } from '@google-cloud/storage';
import type { Account } from 'account/account.entity';
import type { AccountService } from 'account/account.service';
import { type Result, error, getError, isError, ok } from 'core/result';
import type { Context } from 'hono';
import { v4 as uuidv4 } from 'uuid';

const ALLOWED_IMAGE_TYPES = [
    'image/jpg',
    'image/jpeg',
    'image/png',
    'image/webp',
]; // TODO: Do we need to allow image/gif, image/svg?

export type FileValidationError = 'file-too-large' | 'file-type-not-supported';

export function createStorageHandler(accountService: AccountService) {
    /**
     * Handle an upload to GCloud Storage bucket
     */
    return async function handleUpload(ctx: Context) {
        const logger = ctx.get('logger');

        const formData = await ctx.req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return new Response('No file provided', { status: 400 });
        }

        const validationResult = validateFile(file);

        if (isError(validationResult)) {
            const error = getError(validationResult);
            switch (error) {
                case 'file-too-large':
                    logger.error(`File is too large: ${file.size} bytes`);
                    return new Response('File is too large', { status: 413 });
                case 'file-type-not-supported':
                    logger.error(`File type ${file.type} is not supported`);
                    return new Response(
                        `File type ${file.type} is not supported`,
                        {
                            status: 415,
                        },
                    );
            }
        }

        const bucketName = process.env.GCP_BUCKET_NAME;
        const emulatorHost = process.env.GCP_STORAGE_EMULATOR_HOST;

        if (!bucketName) {
            logger.error('Bucket name is not configured');
            return new Response(JSON.stringify({}), {
                status: 500,
            });
        }

        console.log('emulatorHost: ', emulatorHost);

        const storage = emulatorHost
            ? new Storage({
                  apiEndpoint: emulatorHost,
                  projectId: 'dev-project',
                  useAuthWithCustomEndpoint: false,
                  credentials: {
                      client_email: 'fake@example.com',
                      private_key: 'not-a-real-key',
                  },
              })
            : new Storage();

        const account = await accountService.getAccountForSite(ctx.get('site'));
        const storagePath = getStoragePath(account, file.name);

        const bucket = storage.bucket(bucketName);

        await bucket.file(storagePath).save(file.stream(), {
            metadata: {
                contentType: file.type,
            },
            resumable: !emulatorHost,
        });

        const fileUrl = emulatorHost
            ? `${emulatorHost}/${bucketName}/${storagePath}`
            : `https://storage.googleapis.com/${bucketName}/${storagePath}`;

        return new Response(JSON.stringify({ fileUrl }), {
            status: 200,
        });
    };

    function getStoragePath(account: Account, fileName: string) {
        const extension = fileName.split('.').pop();
        let path = `images/${account.uuid}/${uuidv4()}`;
        if (extension) {
            path = `${path}.${extension}`;
        }
        return path;
    }

    function validateFile(file: File): Result<boolean, FileValidationError> {
        if (file.size > 25 * 1024 * 1024) {
            return error('file-too-large');
        }

        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
            return error('file-type-not-supported');
        }

        return ok(true);
    }
}
