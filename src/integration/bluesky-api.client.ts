import type { Logger } from '@logtape/logtape';

import { error, ok, type Result } from '@/core/result';

export type BlueskyApiError =
    | { type: 'network-error'; message: string }
    | { type: 'api-error'; status: number; message: string }
    | { type: 'not-found' };

interface Label {
    val: string;
}

export interface Actor {
    handle: string;
    labels?: Label[];
}

interface SearchActorsResponse {
    actors: Actor[];
}

export const BLUESKY_API_BASE_URL = 'https://public.api.bsky.app/xrpc';
export const BLUESKY_API_SEARCH_ACTORS_ENDPOINT = 'app.bsky.actor.searchActors';

export class BlueskyApiClient {
    constructor(private readonly logger: Logger) {}

    async searchActors(
        query: string,
    ): Promise<Result<Actor[], BlueskyApiError>> {
        const url = `${BLUESKY_API_BASE_URL}/${BLUESKY_API_SEARCH_ACTORS_ENDPOINT}?q=${encodeURIComponent(query)}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
                signal: AbortSignal.timeout(10000), // 10 second timeout
            });

            if (!response.ok) {
                this.logger.warn(
                    `Bluesky API returned non-OK status: ${response.status}`,
                    { query, status: response.status },
                );

                return error({
                    type: 'api-error',
                    status: response.status,
                    message: `API returned status ${response.status}`,
                });
            }

            const data: SearchActorsResponse = await response.json();

            return ok(data.actors);
        } catch (err) {
            this.logger.error('Failed to search Bluesky actors', {
                query,
                error: err,
            });

            return error({
                type: 'network-error',
                message: err instanceof Error ? err.message : 'Unknown error',
            });
        }
    }
}
