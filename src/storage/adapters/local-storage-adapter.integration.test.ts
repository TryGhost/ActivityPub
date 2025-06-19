import { describe, expect, it } from 'vitest';

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getValue, isError } from 'core/result';
import { LocalStorageAdapter } from './local-storage-adapter';

describe('LocalStorageAdapter', () => {
    it('Creates the correct URL', async () => {
        if (!process.env.LOCAL_STORAGE_PATH) {
            throw new Error('LOCAL_STORAGE_PATH is not set');
        }

        const baseUrlWithoutTrailingSlash = new URL(
            'http://localhost:8080/sub/dir',
        );
        const baseUrlWithTrailingSlash = new URL(
            'http://localhost:8080/sub/dir/',
        );

        const adapterWithoutTrailingSlash = new LocalStorageAdapter(
            process.env.LOCAL_STORAGE_PATH,
            baseUrlWithoutTrailingSlash,
        );
        const adapterWithTrailingSlash = new LocalStorageAdapter(
            process.env.LOCAL_STORAGE_PATH,
            baseUrlWithTrailingSlash,
        );

        const fakeFile = new File([], 'test.txt');

        const expectedUrl = new URL(
            'http://localhost:8080/sub/dir/nested/test.txt',
        );

        for (const inputPath of ['/nested/test.txt', 'nested/test.txt']) {
            const resultFromTrailingSlash = await adapterWithTrailingSlash.save(
                fakeFile,
                inputPath,
            );
            if (isError(resultFromTrailingSlash)) {
                throw new Error('Failed to save file');
            }

            const urlFromTrailingSlash = getValue(resultFromTrailingSlash);
            expect(urlFromTrailingSlash).toBe(expectedUrl.href);

            const resultFromWithoutTrailingSlash =
                await adapterWithoutTrailingSlash.save(fakeFile, inputPath);
            if (isError(resultFromWithoutTrailingSlash)) {
                throw new Error('Failed to save file');
            }

            const urlFromWithoutTrailingSlash = getValue(
                resultFromWithoutTrailingSlash,
            );
            expect(urlFromWithoutTrailingSlash).toBe(expectedUrl.href);
        }
    });

    it('exports a class that can save files to disk', async () => {
        if (!process.env.LOCAL_STORAGE_PATH) {
            throw new Error('LOCAL_STORAGE_PATH is not set');
        }

        const baseUrl = new URL('http://localhost:8080');
        const adapter = new LocalStorageAdapter(
            process.env.LOCAL_STORAGE_PATH,
            baseUrl,
        );

        const data = new Blob(['<h1>Hello, world!</h1>'], {
            type: 'text/html',
        });

        const result = await adapter.save(
            new File([data], 'test.txt'),
            'test.txt',
        );

        if (isError(result)) {
            throw new Error('Failed to save file');
        }

        const url = getValue(result);

        expect(url).toBe('http://localhost:8080/test.txt');

        const files = readdirSync(process.env.LOCAL_STORAGE_PATH);
        expect(files).toContain('test.txt');

        const storedData = readFileSync(
            join(process.env.LOCAL_STORAGE_PATH, 'test.txt'),
            'utf-8',
        );
        expect(storedData).toBe('<h1>Hello, world!</h1>');
    });

    it('verifies the correct URL', async () => {
        if (!process.env.LOCAL_STORAGE_PATH) {
            throw new Error('LOCAL_STORAGE_PATH is not set');
        }

        const baseUrl = new URL('http://localhost:8080');
        const adapter = new LocalStorageAdapter(
            process.env.LOCAL_STORAGE_PATH,
            baseUrl,
        );

        const result = await adapter.verifyFileUrl(
            new URL('http://localhost:8080/test.txt'),
        );
        if (isError(result)) {
            throw new Error('Failed to verify file URL');
        }

        expect(getValue(result)).toBe(true);
    });
});
