import { describe, expect, it, vi } from 'vitest';

import ky, { type ResponsePromise } from 'ky';

vi.mock('ky');

import { getSiteSettings } from '@/helpers/ghost';

describe('getSiteSettings', () => {
    const host = 'example.com';

    it('should retrieve settings from Ghost', async () => {
        const settings = {
            site: {
                description: 'foo',
                title: 'bar',
                icon: 'https://example.com/baz.png',
                cover_image: 'https://example.com/qux.png',
                site_uuid: 'e604ed82-188c-4f55-a5ce-9ebfb4184970',
            },
        };

        vi.mocked(ky.get).mockReturnValue({
            json: async () => settings,
        } as ResponsePromise);

        const result = await getSiteSettings(host);

        expect(result).toEqual(settings);
        expect(ky.get).toHaveBeenCalledTimes(1);
        expect(ky.get).toHaveBeenCalledWith(
            `https://${host}/ghost/api/admin/site/`,
        );
    });

    it('sets the site description to null if missing', async () => {
        vi.mocked(ky.get).mockReturnValue({
            json: async () => ({
                site: {
                    title: 'bar',
                    icon: 'https://example.com/baz.png',
                    cover_image: 'https://example.com/qux.png',
                    site_uuid: 'e604ed82-188c-4f55-a5ce-9ebfb4184970',
                },
            }),
        } as ResponsePromise);

        const result = await getSiteSettings(host);

        expect(result).toEqual({
            site: {
                description: null,
                title: 'bar',
                icon: 'https://example.com/baz.png',
                cover_image: 'https://example.com/qux.png',
                site_uuid: 'e604ed82-188c-4f55-a5ce-9ebfb4184970',
            },
        });
    });

    it('sets the site icon to null if missing', async () => {
        vi.mocked(ky.get).mockReturnValue({
            json: async () => ({
                site: {
                    description: 'foo',
                    title: 'bar',
                    cover_image: 'https://example.com/qux.png',
                    site_uuid: 'e604ed82-188c-4f55-a5ce-9ebfb4184970',
                },
            }),
        } as ResponsePromise);

        const result = await getSiteSettings(host);

        expect(result).toEqual({
            site: {
                description: 'foo',
                title: 'bar',
                icon: null,
                cover_image: 'https://example.com/qux.png',
                site_uuid: 'e604ed82-188c-4f55-a5ce-9ebfb4184970',
            },
        });
    });

    it('sets the site title to domain name if missing', async () => {
        vi.mocked(ky.get).mockReturnValue({
            json: async () => ({
                site: {
                    description: 'foo',
                    icon: 'https://example.com/baz.png',
                    cover_image: 'https://example.com/qux.png',
                    site_uuid: 'e604ed82-188c-4f55-a5ce-9ebfb4184970',
                },
            }),
        } as ResponsePromise);

        const result = await getSiteSettings(host);

        expect(result).toEqual({
            site: {
                description: 'foo',
                title: 'example.com',
                icon: 'https://example.com/baz.png',
                cover_image: 'https://example.com/qux.png',
                site_uuid: 'e604ed82-188c-4f55-a5ce-9ebfb4184970',
            },
        });
    });

    it('sets the site cover image to null if missing', async () => {
        vi.mocked(ky.get).mockReturnValue({
            json: async () => ({
                site: {
                    description: 'foo',
                    title: 'bar',
                    icon: 'https://example.com/baz.png',
                    site_uuid: 'e604ed82-188c-4f55-a5ce-9ebfb4184970',
                },
            }),
        } as ResponsePromise);

        const result = await getSiteSettings(host);

        expect(result).toEqual({
            site: {
                description: 'foo',
                title: 'bar',
                icon: 'https://example.com/baz.png',
                cover_image: null,
                site_uuid: 'e604ed82-188c-4f55-a5ce-9ebfb4184970',
            },
        });
    });

    it('sets the site uuid to null if missing', async () => {
        vi.mocked(ky.get).mockReturnValue({
            json: async () => ({
                site: {
                    description: 'foo',
                    title: 'bar',
                    icon: 'https://example.com/baz.png',
                    cover_image: 'https://example.com/qux.png',
                },
            }),
        } as ResponsePromise);

        const result = await getSiteSettings(host);

        expect(result).toEqual({
            site: {
                description: 'foo',
                title: 'bar',
                icon: 'https://example.com/baz.png',
                cover_image: 'https://example.com/qux.png',
                site_uuid: null,
            },
        });
    });
});
