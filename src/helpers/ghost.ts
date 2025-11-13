import ky from 'ky';

export type SiteSettings = {
    site: {
        description: string | null;
        icon: string | null;
        title: string;
        cover_image: string | null;
        site_uuid: string | null;
    };
};

export async function getSiteSettings(host: string): Promise<SiteSettings> {
    const settings = await ky
        .get(`https://${host}/ghost/api/admin/site/`)
        .json<Partial<SiteSettings>>();

    const normalizedHost = host.replace(/^www\./, '');

    return {
        site: {
            description: settings?.site?.description || null,
            title: settings?.site?.title || normalizedHost,
            icon: settings?.site?.icon || null,
            cover_image: settings?.site?.cover_image || null,
            site_uuid: settings?.site?.site_uuid ?? null,
        },
    };
}
