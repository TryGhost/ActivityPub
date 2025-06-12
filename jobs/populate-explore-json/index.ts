import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const gzipAsync = promisify(gzip);

// Simple environment configuration
const config = {
    s3Endpoint: process.env.S3_ENDPOINT || 'https://storage.googleapis.com',
    s3Region: process.env.S3_REGION || 'auto',
    s3Bucket: process.env.S3_BUCKET_NAME || 'explore-data',
    s3FilePath: process.env.S3_FILE_PATH || 'explore/accounts.json',
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
};

// Upload to S3-compatible storage
async function uploadToS3(data: object) {
    const json = JSON.stringify(data, null, 2);
    const compressed = await gzipAsync(json);

    console.log(
        `Uploading ${compressed.length} bytes (compressed from ${json.length} bytes)`,
    );

    const s3Client = new S3Client({
        endpoint: config.s3Endpoint,
        region: config.s3Region,
        forcePathStyle: true, // Required for MinIO and non-AWS S3
        credentials:
            config.s3AccessKeyId && config.s3SecretAccessKey
                ? {
                      accessKeyId: config.s3AccessKeyId,
                      secretAccessKey: config.s3SecretAccessKey,
                  }
                : undefined,
    });

    await s3Client.send(
        new PutObjectCommand({
            Bucket: config.s3Bucket,
            Key: config.s3FilePath,
            Body: compressed,
            ContentType: 'application/json',
            ContentEncoding: 'gzip',
        }),
    );

    console.log(`Uploaded to s3://${config.s3Bucket}/${config.s3FilePath}`);
}

// Main function
async function main() {
    await uploadToS3({
        generated_at: new Date().toISOString(),
        accounts: [],
    });

    process.exit(0);
}

// Run
main().catch(console.error);
