import ky from 'ky';

import {
    ACTOR_DEFAULT_ICON,
    ACTOR_DEFAULT_NAME,
    ACTOR_DEFAULT_SUMMARY,
} from '../constants';

type SiteSettings = {
    site: {
        description: string;
        icon: string;
        title: string;
    };
};

export async function getSiteSettings(host: string): Promise<SiteSettings> {
    const settings = await ky
        .get(`https://${host}/ghost/api/admin/site/`)
        .json<Partial<SiteSettings>>();

    return {
        site: {
            description: settings?.site?.description || ACTOR_DEFAULT_SUMMARY,
            title: settings?.site?.title || ACTOR_DEFAULT_NAME,
            icon: settings?.site?.icon || ACTOR_DEFAULT_ICON,
        },
    };
}
