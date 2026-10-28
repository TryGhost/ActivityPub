import type { Logger } from '@logtape/logtape';

import { error, ok, type Result } from '@/core/result';
import type { BlueskyApiError } from '@/integration/bluesky-api.client';

export const BRIDGY_FED_ATPROTO_DID_URL =
    'https://fed.brid.gy/.well-known/atproto-did';

export class BridgyFedClient {
    constructor(private readonly logger: Logger) {}

    /**
     * Get the DID of the Atmosphere (Bluesky) account Bridgy Fed bridges an
     * ActivityPub actor to, or a `not-found` error if the actor isn't bridged
     * (yet)
     *
     * @see https://fed.brid.gy/docs#bluesky-handle-api
     */
    async getBridgedDid(apId: URL): Promise<Result<string, BlueskyApiError>> {
        const url = `${BRIDGY_FED_ATPROTO_DID_URL}?protocol=ap&id=${encodeURIComponent(apId.href)}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                signal: AbortSignal.timeout(10000),
            });

            if (response.status === 404) {
                return error({ type: 'not-found' });
            }

            if (!response.ok) {
                this.logger.warn(
                    `Bridgy Fed returned non-OK status: ${response.status}`,
                    { apId: apId.href, status: response.status },
                );

                return error({
                    type: 'api-error',
                    status: response.status,
                    message: `API returned status ${response.status}`,
                });
            }

            const did = (await response.text()).trim();

            if (!did.startsWith('did:')) {
                return error({ type: 'not-found' });
            }

            return ok(did);
        } catch (err) {
            this.logger.error('Failed to get bridged DID from Bridgy Fed', {
                apId: apId.href,
                error: err,
            });

            return error({
                type: 'network-error',
                message: err instanceof Error ? err.message : 'Unknown error',
            });
        }
    }
}
