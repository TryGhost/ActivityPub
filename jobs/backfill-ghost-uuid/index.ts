#!/usr/bin/env bun

import mysql from 'mysql2/promise';

interface SiteInfo {
    site: {
        title: string;
        description: string;
        logo: string | null;
        icon: string | null;
        cover_image: string | null;
        accent_color: string;
        locale: string;
        url: string;
        version: string;
        allow_external_signup: boolean;
        sentry_dsn: string | null;
        sentry_env: string | null;
        site_uuid: string;
    };
}

interface SiteRow {
    id: number;
    host: string;
}

export async function fetchSiteGhostUUID(host: string): Promise<string | null> {
    try {
        const url = `https://${host}/ghost/api/admin/site/`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(url, {
            headers: {
                Accept: 'application/json',
            },
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.warn(
                `Failed to fetch site info for ${host} (${response.status})`,
            );

            return null;
        }

        const data: SiteInfo = await response.json();

        if (!data.site || !data.site.site_uuid) {
            console.warn(`No site_uuid found for ${host}`);

            return null;
        }

        return data.site.site_uuid;
    } catch (error) {
        console.warn(`Failed to fetch site info for ${host}: ${error.message}`);

        return null;
    }
}

export async function getSitesWithoutGhostUUID(
    connection: mysql.Connection,
): Promise<SiteRow[]> {
    const [rows] = await connection.execute(
        'SELECT id, host FROM sites WHERE ghost_uuid IS NULL ORDER BY id',
    );

    return rows as SiteRow[];
}

export async function updateSiteGhostUUID(
    connection: mysql.Connection,
    siteId: number,
    ghostUuid: string,
): Promise<'success' | 'duplicate'> {
    try {
        await connection.execute(
            'UPDATE sites SET ghost_uuid = ? WHERE id = ?',
            [ghostUuid, siteId],
        );

        return 'success';
    } catch (error: unknown) {
        if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ER_DUP_ENTRY'
        ) {
            return 'duplicate';
        }

        throw error;
    }
}

async function main() {
    const connection = await mysql.createConnection(
        process.env.DB_SOCKET_PATH
            ? {
                  socketPath: process.env.DB_SOCKET_PATH,
                  user: process.env.DB_USER,
                  password: process.env.DB_PASSWORD,
                  database: process.env.DB_NAME,
              }
            : {
                  host: process.env.DB_HOST,
                  port: Number.parseInt(process.env.DB_PORT || '3306', 10),
                  user: process.env.DB_USER,
                  password: process.env.DB_PASSWORD,
                  database: process.env.DB_NAME,
              },
    );

    try {
        console.log('Starting backfill-ghost-uuid...');

        const sites = await getSitesWithoutGhostUUID(connection);

        console.log(`Found ${sites.length} sites without ghost_uuid`);

        if (sites.length === 0) {
            console.log('No sites to process');

            return;
        }

        let updated = 0;
        let skipped = 0;
        let duplicates = 0;

        for (let i = 0; i < sites.length; i++) {
            const site = sites[i];

            console.log(
                `Processing site ${i + 1} of ${sites.length}: ${site.host}`,
            );

            const ghostUuid = await fetchSiteGhostUUID(site.host);

            if (ghostUuid) {
                const result = await updateSiteGhostUUID(
                    connection,
                    site.id,
                    ghostUuid,
                );

                if (result === 'success') {
                    console.log(
                        `Updated site ${site.id} with UUID ${ghostUuid}`,
                    );

                    updated++;
                } else if (result === 'duplicate') {
                    console.warn(
                        `Duplicate UUID ${ghostUuid} for ${site.host} (site ${site.id})`,
                    );

                    duplicates++;
                }
            } else {
                console.warn(`Failed to fetch UUID for ${site.host}`);

                skipped++;
            }

            // Add a small delay to avoid tripping rate limits
            await Bun.sleep(500);
        }

        console.log(
            `Completed! Updated ${updated} sites, skipped ${skipped} sites (fetch failed), ${duplicates} sites (duplicate UUID)`,
        );
    } finally {
        await connection.end();
    }

    process.exit(0);
}

if (import.meta.main) {
    main().catch((error) => {
        console.error('Unhandled error:', error);

        process.exit(1);
    });
}
