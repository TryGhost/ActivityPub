import type { Result } from 'core/result';

export type StorageError = 'error-saving-file';
export interface StorageAdapter {
    save(file: File, path: string): Promise<Result<string, StorageError>>;
}
