import { type Bucket, Storage } from '@google-cloud/storage';
import type { Logger } from '@logtape/logtape';
import { type Result, error, ok } from 'core/result';
import type {
    StorageAdapter,
    StorageError,
    VerificationError,
} from './storage-adapter';

export class GCPStorageAdapter implements StorageAdapter {
    private storage: Storage;
    private bucket: Bucket;

    constructor(
        private readonly bucketName: string,
        private readonly logging: Logger,
        private readonly emulatorHost?: string,
    ) {
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
            return;
        }

        try {
            this.storage = new Storage();
            this.bucket = this.storage.bucket(this.bucketName);
        } catch (err) {
            throw new Error(`Failed to create storage instance ${err}`);
        }
    }

    async save(
        file: File,
        path: string,
    ): Promise<Result<string, StorageError>> {
        this.logging.info(
            'save in GCPStorageAdapter called with file {file} and path {path}',
            {
                file: file.name,
                path,
            },
        );

        try {
            const arrayBuffer = await file.arrayBuffer();
            await this.bucket.file(path).save(Buffer.from(arrayBuffer), {
                metadata: {
                    contentType: file.type,
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
                ? `${this.emulatorHost.replace('fake-gcs', 'localhost')}/storage/v1/b/${this.bucketName}/o/${encodeURIComponent(path)}?alt=media`
                : this.bucket.file(path).publicUrl();

            return ok(fileUrl);
        } catch (err) {
            this.logging.error('Failed to save file to GCP bucket {error}', {
                error: err,
                file,
                path,
            });
            return error('error-saving-file');
        }
    }

    async verifyFileUrl(url: URL): Promise<Result<boolean, VerificationError>> {
        // Check if we're using the GCS emulator and verify the URL matches the emulator's base URL pattern
        if (this.emulatorHost) {
            let emulatorUrl: URL;
            try {
                emulatorUrl = new URL(
                    this.emulatorHost.replace('fake-gcs', 'localhost'),
                );
            } catch (err) {
                console.log('err', err);
                return error('invalid-url');
            }

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
        try {
            const [exists] = await this.bucket.file(filePath).exists();
            if (!exists) {
                return error('file-not-found');
            }
        } catch (err) {
            return error('file-not-found');
        }

        return ok(true);
    }
}
