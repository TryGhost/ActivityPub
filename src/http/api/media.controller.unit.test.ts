import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import type { Context } from 'hono';

import type { AccountService } from '@/account/account.service';
import { error, ok } from '@/core/result';
import { MediaController } from '@/http/api/media.controller';
import type { ImageStorageService } from '@/storage/image-storage.service';

describe('Image Upload API', () => {
    let accountService: AccountService;
    let imageStorageService: ImageStorageService;
    let mediaController: MediaController;
    let mockLogger: { error: Mock };
    const getMockContext = (): Context =>
        ({
            get: (key: string) => {
                if (key === 'site') {
                    return {
                        id: 123,
                        host: 'example.com',
                        webhook_secret: 'secret',
                        ghost_uuid: 'e604ed82-188c-4f55-a5ce-9ebfb4184970',
                    };
                }
                if (key === 'logger') {
                    return mockLogger;
                }
            },
            req: {
                formData: vi.fn().mockResolvedValue(new FormData()),
            },
        }) as unknown as Context;

    beforeEach(() => {
        mockLogger = { error: vi.fn() };
        accountService = {
            getAccountForSite: vi.fn().mockResolvedValue({
                uuid: 'test-uuid',
            }),
        } as unknown as AccountService;

        imageStorageService = {
            save: vi.fn().mockResolvedValue(ok('https://example.com/test.png')),
        } as unknown as ImageStorageService;

        mediaController = new MediaController(
            accountService,
            imageStorageService,
        );
    });

    it('returns 400 if no file is provided', async () => {
        const ctx = getMockContext();
        const response = await mediaController.handleImageUpload(ctx);

        expect(response.status).toBe(400);
        expect(await response.text()).toBe('No valid file provided');
    });

    it('returns 400 if file is not a File instance', async () => {
        const ctx = getMockContext();
        const formData = new FormData();
        formData.append('file', 'not-a-file');
        (ctx.req.formData as Mock).mockResolvedValue(formData);

        const response = await mediaController.handleImageUpload(ctx);

        expect(response.status).toBe(400);
        expect(await response.text()).toBe('No valid file provided');
    });

    it('returns 413 when the file is too large', async () => {
        const ctx = getMockContext();
        const formData = new FormData();
        formData.append(
            'file',
            new globalThis.File(['test'], 'test.png', { type: 'image/png' }),
        );
        (ctx.req.formData as Mock).mockResolvedValue(formData);

        (imageStorageService.save as Mock).mockResolvedValue(
            error('file-too-large'),
        );

        const response = await mediaController.handleImageUpload(ctx);

        expect(response.status).toBe(413);
        expect(await response.text()).toBe('File is too large');
        expect(mockLogger.error).toHaveBeenCalledWith(
            expect.stringContaining('File is too large'),
        );
    });

    it('returns 415 file type is not supported', async () => {
        const ctx = getMockContext();
        const formData = new FormData();
        formData.append(
            'file',
            new globalThis.File(['test'], 'test.txt', { type: 'text/plain' }),
        );
        (ctx.req.formData as Mock).mockResolvedValue(formData);

        (imageStorageService.save as Mock).mockResolvedValue(
            error('file-type-not-supported'),
        );

        const response = await mediaController.handleImageUpload(ctx);

        expect(response.status).toBe(415);
        expect(await response.text()).toBe(
            'File type text/plain is not supported',
        );
        expect(mockLogger.error).toHaveBeenCalledWith(
            expect.stringContaining('File type text/plain is not supported'),
        );
    });

    it('returns 200 with file URL on successful upload', async () => {
        const ctx = getMockContext();
        const formData = new FormData();
        formData.append(
            'file',
            new globalThis.File(['test'], 'test.png', { type: 'image/png' }),
        );
        (ctx.req.formData as Mock).mockResolvedValue(formData);

        const expectedUrl = 'https://example.com/test.png';
        (imageStorageService.save as Mock).mockResolvedValue(ok(expectedUrl));

        const response = await mediaController.handleImageUpload(ctx);

        expect(response.status).toBe(200);
        const responseData = await response.json();
        expect(responseData.fileUrl).toBe(expectedUrl);
    });
});
