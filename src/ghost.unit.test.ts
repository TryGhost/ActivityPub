import { describe, expect, it, vi } from 'vitest';

import ky, { ResponsePromise } from 'ky';

vi.mock('ky');

import { getSiteSettings } from './ghost';
import {
    ACTOR_DEFAULT_ICON,
    ACTOR_DEFAULT_NAME,
    ACTOR_DEFAULT_SUMMARY
} from './constants';

describe('getSiteSettings', function () {
    const host = 'example.com';

    it('should retrieve settings from Ghost', async function () {
        const settings = {
            site: {
                description: 'foo',
                title: 'bar',
                icon: 'https://example.com/baz.png'
            }
        };

        vi.mocked(ky.get).mockReturnValue({
            json: async () => settings
        } as ResponsePromise);

        const result = await getSiteSettings(host);

        expect(result).toEqual(settings);
        expect(ky.get).toHaveBeenCalledTimes(1);
        expect(ky.get).toHaveBeenCalledWith(`https://${host}/ghost/api/admin/site/`);
    });

    it('should use defaults for missing settings', async function () {
        let result;

        // Missing description
        vi.mocked(ky.get).mockReturnValue({
            json: async () => ({
                site: {
                    title: 'bar',
                    icon: 'https://example.com/baz.png'
                }
            })
        } as ResponsePromise);

        result = await getSiteSettings(host);

        expect(result).toEqual({
            site: {
                description: ACTOR_DEFAULT_SUMMARY,
                title: 'bar',
                icon: 'https://example.com/baz.png'
            }
        });

        // Missing title
        vi.mocked(ky.get).mockReturnValue({
            json: async () => ({
                site: {
                    description: 'foo',
                    icon: 'https://example.com/baz.png'
                }
            })
        } as ResponsePromise);

        result = await getSiteSettings(host);

        expect(result).toEqual({
            site: {
                description: 'foo',
                title: ACTOR_DEFAULT_NAME,
                icon: 'https://example.com/baz.png'
            }
        });

        // Missing icon
        vi.mocked(ky.get).mockReturnValue({
            json: async () => ({
                site: {
                    description: 'foo',
                    title: 'bar'
                }
            })
        } as ResponsePromise);

        result = await getSiteSettings(host);

        expect(result).toEqual({
            site: {
                description: 'foo',
                title: 'bar',
                icon: ACTOR_DEFAULT_ICON
            }
        });

        // Missing everything
        vi.mocked(ky.get).mockReturnValue({
            json: async () => ({})
        } as ResponsePromise);

        result = await getSiteSettings(host);

        expect(result).toEqual({
            site: {
                description: ACTOR_DEFAULT_SUMMARY,
                title: ACTOR_DEFAULT_NAME,
                icon: ACTOR_DEFAULT_ICON
            }
        });
    });
});
