import { type Bucket, Storage } from '@google-cloud/storage';

export class GCPStorageService {
    private storage: Storage;
    private bucket: Bucket;
    private bucketName: string;

    constructor() {
        this.bucketName = process.env.GCP_BUCKET_NAME || '';
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
        if (['staging', 'production'].includes(process.env.NODE_ENV || '')) {
            try {
                const [exists] = await this.bucket.exists();
                if (!exists) {
                    throw new Error(
                        `Bucket [${this.bucketName}] does not exist`,
                    );
                }
            } catch (err) {
                throw new Error(`Failed to verify GCP bucket ${err}`);
            }
        }

        if (process.env.GCP_STORAGE_EMULATOR_HOST) {
            this.storage = new Storage({
                apiEndpoint: process.env.GCP_STORAGE_EMULATOR_HOST,
                projectId: 'dev-project',
                useAuthWithCustomEndpoint: false,
                credentials: {
                    client_email: 'fake@example.com',
                    private_key: 'not-a-real-key',
                },
            });

            this.bucket = this.storage.bucket(this.bucketName);

            const [exists] = await this.bucket.exists();
            if (!exists) {
                await this.bucket.create(); //Create a bucket in fake-gcs
            }
        }
    }

    getBucket(): Bucket {
        return this.bucket;
    }
}
