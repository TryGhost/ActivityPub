import { promises as fs } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { error, ok, type Result } from '@/core/result';
import type {
    StorageAdapter,
    StorageError,
    VerificationError,
} from '@/storage/adapters/storage-adapter';

export class LocalStorageAdapter implements StorageAdapter {
    private readonly hostingUrl: URL;

    constructor(
        private readonly storagePath: string,
        hostingUrl: URL,
    ) {
        if (!hostingUrl.href.endsWith('/')) {
            this.hostingUrl = new URL(`${hostingUrl.href}/`);
        } else {
            this.hostingUrl = hostingUrl;
        }
    }

    async save(
        file: File,
        path: string,
        // TODO this should return Result<URL>
    ): Promise<Result<string, StorageError>> {
        if (path.startsWith('/')) {
            return this.save(file, path.slice(1));
        }

        try {
            const buffer = Buffer.from(await file.arrayBuffer());

            const fullPath = normalize(join(this.storagePath, path));

            if (!fullPath.startsWith(this.storagePath)) {
                return error('error-saving-file');
            }

            const directory = dirname(fullPath);

            await fs.mkdir(directory, { recursive: true });

            await fs.writeFile(fullPath, buffer);

            const url = new URL(path, this.hostingUrl).toString();

            return ok(url);
        } catch (_err) {
            return error('error-saving-file');
        }
    }

    async verifyFileUrl(url: URL): Promise<Result<boolean, VerificationError>> {
        return url.href.startsWith(this.hostingUrl.href)
            ? ok(true)
            : error('invalid-url');
    }
}
