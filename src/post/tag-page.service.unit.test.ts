import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    type Mock,
    vi,
} from 'vitest';

import type { Logger } from '@logtape/logtape';

import { TagPageService } from '@/post/tag-page.service';

describe('TagPageService', () => {
    const siteUrl = new URL('https://example.com/blog/');
    let fetchMock: Mock<(url: URL) => Promise<Response>>;
    let service: TagPageService;

    beforeEach(() => {
        fetchMock = vi.fn(async (url: URL) => {
            const status = url.pathname === '/blog/tag/coffee/' ? 200 : 404;

            return new Response(null, { status });
        });
        vi.stubGlobal('fetch', fetchMock);

        service = new TagPageService({ warn: vi.fn() } as unknown as Logger);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('returns the hashtags whose tag page exists', async () => {
        const result = await service.getHashtagsWithTagPage(siteUrl, [
            'coffee',
            'tea',
        ]);

        expect(result).toEqual(new Set(['coffee']));
        expect(fetchMock).toHaveBeenCalledWith(
            new URL('https://example.com/blog/tag/coffee/'),
            expect.objectContaining({ method: 'HEAD' }),
        );
        expect(fetchMock).toHaveBeenCalledWith(
            new URL('https://example.com/blog/tag/tea/'),
            expect.objectContaining({ method: 'HEAD' }),
        );
    });

    it('requests each tag page once while it is cached', async () => {
        await Promise.all([
            service.getHashtagsWithTagPage(siteUrl, ['coffee', 'tea']),
            service.getHashtagsWithTagPage(siteUrl, ['coffee']),
        ]);
        const result = await service.getHashtagsWithTagPage(siteUrl, [
            'coffee',
            'tea',
        ]);

        expect(result).toEqual(new Set(['coffee']));
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('requests a tag page again once the cached result expires', async () => {
        vi.useFakeTimers();

        await service.getHashtagsWithTagPage(siteUrl, ['tea']);

        vi.advanceTimersByTime(14 * 60 * 1000);
        await service.getHashtagsWithTagPage(siteUrl, ['tea']);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(2 * 60 * 1000);
        await service.getHashtagsWithTagPage(siteUrl, ['tea']);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not link or cache a tag page that could not be requested', async () => {
        fetchMock.mockRejectedValueOnce(new Error('timeout'));

        const failed = await service.getHashtagsWithTagPage(siteUrl, [
            'coffee',
        ]);
        const retried = await service.getHashtagsWithTagPage(siteUrl, [
            'coffee',
        ]);

        expect(failed).toEqual(new Set());
        expect(retried).toEqual(new Set(['coffee']));
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
