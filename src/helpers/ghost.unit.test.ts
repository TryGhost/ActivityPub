import { describe, expect, it, vi } from 'vitest';

import ky, { type ResponsePromise } from 'ky';

vi.mock('ky');

import { ACTOR_DEFAULT_NAME } from '../constants';
import { getSiteSettings } from './ghost';

describe('getSiteSettings', () => {
    const host = 'example.com';

    it('should retrieve settings from Ghost', async () => {
        const settings = {
            site: {
                description: 'foo',
                title: 'bar',
                icon: 'https://example.com/baz.png',
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
                site: { title: 'bar', icon: 'https://example.com/baz.png' },
            }),
        } as ResponsePromise);

        const result = await getSiteSettings(host);

        expect(result).toEqual({
            site: {
                description: null,
                title: 'bar',
                icon: 'https://example.com/baz.png',
            },
        });
    });

    it('sets the site icon to null if missing', async () => {
        vi.mocked(ky.get).mockReturnValue({
            json: async () => ({
                site: { description: 'foo', title: 'bar' },
            }),
        } as ResponsePromise);

        const result = await getSiteSettings(host);

        expect(result).toEqual({
            site: {
                description: 'foo',
                title: 'bar',
                icon: null,
            },
        });
    });

    it('sets the site icon to a default value if missing', async () => {
        vi.mocked(ky.get).mockReturnValue({
            json: async () => ({
                site: {
                    description: 'foo',
                    icon: 'https://example.com/baz.png',
                },
            }),
        } as ResponsePromise);

        const result = await getSiteSettings(host);

        expect(result).toEqual({
            site: {
                description: 'foo',
                title: ACTOR_DEFAULT_NAME,
                icon: 'https://example.com/baz.png',
            },
        });
    });
});
