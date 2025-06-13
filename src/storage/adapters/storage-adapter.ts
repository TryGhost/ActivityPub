export interface StorageAdapter {
    save(file: File, path: string): Promise<string>;
}
