import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Knex } from 'knex';

import type { AppContext } from '@/app';
import { PreferencesController } from '@/http/api/preferences.controller';
import { KnexPreferencesRepository } from '@/preferences/preferences.repository.knex';
import { PreferencesService } from '@/preferences/preferences.service';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

describe('PreferencesController', () => {
    let db: Knex;
    let fixtureManager: FixtureManager;
    let preferencesController: PreferencesController;

    beforeAll(async () => {
        db = await createTestDb();
        fixtureManager = createFixtureManager(db);
    });

    beforeEach(async () => {
        await fixtureManager.reset();
        preferencesController = new PreferencesController(
            new PreferencesService(new KnexPreferencesRepository(db)),
        );
    });

    function createContext({
        site,
        body,
        bodyError,
    }: {
        site: { id: number };
        body?: unknown;
        bodyError?: Error;
    }) {
        return {
            get: (key: string) => {
                if (key === 'site') {
                    return site;
                }
            },
            req: {
                json: async () => {
                    if (bodyError) {
                        throw bodyError;
                    }

                    return body;
                },
            },
        } as unknown as AppContext;
    }

    it('returns showSensitiveMedia false by default', async () => {
        const [, site] = await fixtureManager.createInternalAccount();

        const response = await preferencesController.handleGetPreferences(
            createContext({ site }),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            showSensitiveMedia: false,
        });
    });

    it('returns 500 when preferences are requested for a site without a user', async () => {
        const response = await preferencesController.handleGetPreferences(
            createContext({ site: { id: 999999 } }),
        );

        expect(response.status).toBe(500);
    });

    it('updates showSensitiveMedia to true', async () => {
        const [, site, userId] = await fixtureManager.createInternalAccount();

        const response = await preferencesController.handleUpdatePreferences(
            createContext({
                site,
                body: { showSensitiveMedia: true },
            }),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            showSensitiveMedia: true,
        });

        const user = await db('users').where({ id: userId }).first();
        expect(Boolean(user.show_sensitive_media)).toBe(true);
    });

    it('updates showSensitiveMedia back to false', async () => {
        const [, site, userId] = await fixtureManager.createInternalAccount();
        await db('users')
            .where({ id: userId })
            .update({ show_sensitive_media: true });

        const response = await preferencesController.handleUpdatePreferences(
            createContext({
                site,
                body: { showSensitiveMedia: false },
            }),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            showSensitiveMedia: false,
        });

        const user = await db('users').where({ id: userId }).first();
        expect(Boolean(user.show_sensitive_media)).toBe(false);
    });

    it('returns 200 when updating showSensitiveMedia to its current value', async () => {
        const [, site, userId] = await fixtureManager.createInternalAccount();
        await db('users')
            .where({ id: userId })
            .update({ show_sensitive_media: true });

        const firstResponse =
            await preferencesController.handleUpdatePreferences(
                createContext({
                    site,
                    body: { showSensitiveMedia: true },
                }),
            );

        expect(firstResponse.status).toBe(200);
        await expect(firstResponse.json()).resolves.toEqual({
            showSensitiveMedia: true,
        });

        const secondResponse =
            await preferencesController.handleUpdatePreferences(
                createContext({
                    site,
                    body: { showSensitiveMedia: true },
                }),
            );

        expect(secondResponse.status).toBe(200);
        await expect(secondResponse.json()).resolves.toEqual({
            showSensitiveMedia: true,
        });
    });

    it('returns 500 when updating preferences for a site without a user', async () => {
        const response = await preferencesController.handleUpdatePreferences(
            createContext({
                site: { id: 999999 },
                body: { showSensitiveMedia: true },
            }),
        );

        expect(response.status).toBe(500);
    });

    it('rejects invalid payloads', async () => {
        const [, site] = await fixtureManager.createInternalAccount();

        const response = await preferencesController.handleUpdatePreferences(
            createContext({
                site,
                body: { showSensitiveMedia: 'true' },
            }),
        );

        expect(response.status).toBe(400);
    });

    it('rejects payloads with extra fields', async () => {
        const [, site] = await fixtureManager.createInternalAccount();

        const response = await preferencesController.handleUpdatePreferences(
            createContext({
                site,
                body: {
                    showSensitiveMedia: true,
                    extra: true,
                },
            }),
        );

        expect(response.status).toBe(400);
    });

    it('rejects malformed JSON payloads', async () => {
        const [, site] = await fixtureManager.createInternalAccount();

        const response = await preferencesController.handleUpdatePreferences(
            createContext({
                site,
                bodyError: new Error('Invalid JSON'),
            }),
        );

        expect(response.status).toBe(400);
    });
});
