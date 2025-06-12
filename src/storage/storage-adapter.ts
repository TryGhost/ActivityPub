import type { Result } from 'core/result';

export type FileStorageError = 'network-error';

export interface StorageAdapter {
    init(): Promise<void>;
    save(file: File, path: string): Promise<Result<string, FileStorageError>>;
}
