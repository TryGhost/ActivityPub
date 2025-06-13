import { type Bucket, Storage } from '@google-cloud/storage';
import type { StorageAdapter } from './storage-adapter';

export class GCPStorageAdapter implements StorageAdapter {
    private storage: Storage;
    private bucket: Bucket;

    constructor(
        private readonly bucketName: string,
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

    async save(file: File, path: string): Promise<string> {
        await this.bucket.file(path).save(file.stream(), {
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

        return fileUrl;
    }
}
