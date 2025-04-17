import { type Bucket, Storage } from '@google-cloud/storage';
import { getLogger } from '@logtape/logtape';

const logging = getLogger(['storage']);

export class GCPStorageService {
    private storage: Storage;
    private bucket: Bucket;
    private bucketName: string;

    constructor() {
        this.bucketName = process.env.GCP_BUCKET_NAME || '';
        if (!this.bucketName) {
            logging.error('GCP bucket name is not configured');
            process.exit(1);
        }
        this.storage = new Storage();
        this.bucket = this.storage.bucket(this.bucketName);
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
                logging.info('GCP bucket exists');
            } catch (err) {
                logging.error('Failed to verify GCP bucket {error}', {
                    error: err,
                });
                process.exit(1);
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
                logging.info('Creating GCP bucket in fake-gcs');
                await this.bucket.create(); //Create a bucket in fake-gcs
            }
        }
    }

    getBucket(): Bucket {
        return this.bucket;
    }
}
