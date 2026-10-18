import type { Logger } from '@logtape/logtape';

import { error, ok, type Result } from '@/core/result';

export type BlueskyApiError =
    | { type: 'network-error'; message: string }
    | { type: 'api-error'; status: number; message: string }
    | { type: 'not-found' };

export interface Profile {
    did: string;
    handle: string;
}

export const BLUESKY_API_BASE_URL = 'https://public.api.bsky.app/xrpc';
export const BLUESKY_API_GET_PROFILE_ENDPOINT = 'app.bsky.actor.getProfile';

export class BlueskyApiClient {
    constructor(private readonly logger: Logger) {}

    async getProfile(did: string): Promise<Result<Profile, BlueskyApiError>> {
        const url = `${BLUESKY_API_BASE_URL}/${BLUESKY_API_GET_PROFILE_ENDPOINT}?actor=${encodeURIComponent(did)}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
                signal: AbortSignal.timeout(10000), // 10 second timeout
            });

            // The AppView answers 400 for accounts it hasn't indexed yet
            if (response.status === 400 || response.status === 404) {
                return error({ type: 'not-found' });
            }

            if (!response.ok) {
                this.logger.warn(
                    `Bluesky API returned non-OK status: ${response.status}`,
                    { did, status: response.status },
                );

                return error({
                    type: 'api-error',
                    status: response.status,
                    message: `API returned status ${response.status}`,
                });
            }

            const data: Profile = await response.json();

            return ok({ did: data.did, handle: data.handle });
        } catch (err) {
            this.logger.error('Failed to get Bluesky profile', {
                did,
                error: err,
            });

            return error({
                type: 'network-error',
                message: err instanceof Error ? err.message : 'Unknown error',
            });
        }
    }
}
