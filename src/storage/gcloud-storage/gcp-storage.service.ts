import { type Bucket, Storage } from '@google-cloud/storage';
import type { Logger } from '@logtape/logtape';
import { type Result, error, isError, ok } from 'core/result';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

const ALLOWED_IMAGE_TYPES = [
    'image/jpg',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
];

type FileValidationError = 'file-too-large' | 'file-type-not-supported';
export type ImageVerificationError =
    | 'invalid-url'
    | 'file-not-found'
    | 'invalid-file-path'
    | 'gcs-error';

export class GCPStorageService {
    private logger: Logger;
    private storage: Storage;
    private bucket: Bucket;
    private bucketName: string;
    private emulatorHost: string | undefined;

    constructor(logging: Logger) {
        this.logger = logging;
        this.bucketName = process.env.GCP_BUCKET_NAME || '';
        this.emulatorHost = process.env.GCP_STORAGE_EMULATOR_HOST;
        if (!this.bucketName) {
            throw new Error('GCP bucket name is not configured');
        }
        try {
            this.storage = new Storage();
            this.bucket = this.storage.bucket(this.bucketName);
        } catch (err) {
            throw new Error(`Failed to create storage instance ${err}`);
        }
    }

    async init(): Promise<void> {
        if (this.emulatorHost) {
            this.storage = new Storage({
                apiEndpoint: this.emulatorHost,
                projectId: 'activitypub',
                useAuthWithCustomEndpoint: false,
                credentials: {
                    client_email: 'fake@example.com',
                    private_key: 'not-a-real-key',
                },
            });

            this.bucket = this.storage.bucket(this.bucketName);
        }

        try {
            const [exists] = await this.bucket.exists();
            if (!exists) {
                throw new Error(`Bucket [${this.bucketName}] does not exist`);
            }
        } catch (err) {
            throw new Error(`Failed to verify GCP bucket ${err}`);
        }
    }

    async saveFile(
        file: File,
        accountUuid: string,
    ): Promise<Result<string, FileValidationError>> {
        const validationResult = this.validateFile(file);
        if (isError(validationResult)) {
            return validationResult;
        }

        // Check if this is a HEIC/HEIF file that will be converted to JPEG
        const format = file.type.split('/')[1];
        const isHeicFile = format === 'heic' || format === 'heif';
        const outputExtension = isHeicFile ? 'jpg' : undefined;
        const outputContentType = isHeicFile ? 'image/jpeg' : file.type;

        const storagePath = this.getStoragePath(
            file.name,
            accountUuid,
            outputExtension,
        );
        const compressedBuffer = await this.compressFile(file);

        await this.bucket.file(storagePath).save(compressedBuffer, {
            metadata: {
                contentType: outputContentType,
            },
            // resumable uploads (default: true) use a session and chunked uploads.
            // Disabled it in dev/testing because resumable mode can be unreliable with GCS emulators.
            // This is fine for small files like images in dev/testing.
            resumable: !this.emulatorHost,
        });

        // When using the GCS emulator, we need to construct a custom URL since the emulator runs on localhost
        // and doesn't support the standard publicUrl() method. In production, we use the bucket's publicUrl() method
        // which generates a proper Google Cloud Storage URL.
        const fileUrl = this.emulatorHost
            ? `${this.emulatorHost.replace('fake-gcs', 'localhost')}/storage/v1/b/${this.bucketName}/o/${encodeURIComponent(storagePath)}?alt=media`
            : this.bucket.file(storagePath).publicUrl();

        return ok(fileUrl);
    }

    private getStoragePath(
        fileName: string,
        accountUuid: string,
        overrideExtension?: string,
    ): string {
        const extension =
            overrideExtension ||
            (fileName.includes('.')
                ? fileName.split('.').pop()?.toLowerCase()
                : '');
        let path = `images/${accountUuid}/${uuidv4()}`;
        if (extension) {
            path = `${path}.${extension}`;
        }
        return path;
    }

    private validateFile(file: File): Result<boolean, FileValidationError> {
        if (file.size > 5 * 1024 * 1024) {
            return error('file-too-large');
        }

        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
            return error('file-type-not-supported');
        }

        return ok(true);
    }

    private async compressFile(file: File): Promise<Buffer> {
        const chunks: Buffer[] = [];

        for await (const chunk of file.stream()) {
            if (Buffer.isBuffer(chunk)) {
                chunks.push(chunk);
            } else {
                chunks.push(Buffer.from(chunk));
            }
        }
        const fileBuffer = Buffer.concat(chunks);

        try {
            const sharpPipeline = sharp(fileBuffer).rotate().resize({
                width: 2000,
                height: 2000,
                fit: 'inside',
                withoutEnlargement: true,
            });

            const format = file.type.split('/')[1];

            if (
                format === 'jpeg' ||
                format === 'jpg' ||
                format === 'heic' ||
                format === 'heif'
            ) {
                return sharpPipeline.jpeg({ quality: 75 }).toBuffer();
            }

            if (format === 'png') {
                return sharpPipeline.png({ compressionLevel: 9 }).toBuffer();
            }

            if (format === 'webp') {
                return sharpPipeline.webp({ quality: 75 }).toBuffer();
            }

            return fileBuffer;
        } catch (error) {
            this.logger.error(
                'Image compression failed, keeping original file',
                {
                    error,
                    fileName: file.name,
                    fileType: file.type,
                },
            );
            return fileBuffer;
        }
    }

    async verifyImageUrl(
        url: URL,
    ): Promise<Result<boolean, ImageVerificationError>> {
        try {
            // Check if we're using the GCS emulator and verify the URL matches the emulator's base URL pattern
            if (this.emulatorHost) {
                const emulatorUrl = new URL(
                    this.emulatorHost.replace('fake-gcs', 'localhost'),
                );
                if (url.host !== emulatorUrl.host) {
                    return error('invalid-url');
                }
                return ok(true);
            }

            // Verify if the URL matches the standard Google Cloud Storage public URL pattern for our bucket
            if (url.host !== 'storage.googleapis.com') {
                return error('invalid-url');
            }

            // Extract the file path from the URL by removing the bucket prefix
            let filePath = url.pathname.split(`/${this.bucketName}/`)[1];
            if (!filePath) {
                return error('invalid-file-path');
            }

            // URL-decode the filePath to handle any special characters
            filePath = decodeURIComponent(filePath);

            // Verify that the file actually exists in our bucket
            const [exists] = await this.bucket.file(filePath).exists();
            if (!exists) {
                return error('file-not-found');
            }

            return ok(true);
        } catch (err) {
            this.logger.error(`Error while verifying gcs image: ${err}`, {
                err,
            });
            return error('gcs-error');
        }
    }
}
