import { resolveTxt } from 'node:dns/promises';

import { validatePublicUrl } from '@fedify/vocab-runtime';
import type { Logger } from '@logtape/logtape';

import { error, ok, type Result } from '@/core/result';
import { isLocalEnvironment } from '@/helpers/environment';

export type DnsResolutionError = { type: 'dns-error'; code: string };

const DID_PATTERN = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;

export const MAX_WELL_KNOWN_REDIRECTS = 5;

// "No such record" answers - anything else (SERVFAIL, timeout, refused...)
// means we could not find out, which must not be treated as "no record"
const DNS_NO_RECORD_CODES = new Set(['ENOTFOUND', 'ENODATA']);

/**
 * Resolves atproto handles the same way atproto clients do, so we can check
 * who a domain handle points at before claiming it
 *
 * @see https://atproto.com/specs/handle
 */
function allowPrivateAddress() {
    return (
        process.env.ALLOW_PRIVATE_ADDRESS === 'true' &&
        isLocalEnvironment(process.env.NODE_ENV)
    );
}

export class AtprotoHandleResolver {
    constructor(private readonly logger: Logger) {}

    /**
     * Get every DID published in the `_atproto.<domain>` TXT records
     *
     * All of them are returned rather than the first one: resolvers disagree
     * on how to handle multiple records (some pick the first, some ignore
     * DNS entirely), so any record we don't recognise matters
     */
    async resolveDns(
        domain: string,
    ): Promise<Result<string[], DnsResolutionError>> {
        try {
            const records = await resolveTxt(`_atproto.${domain}`);

            return ok(
                records
                    .map((chunks) => chunks.join(''))
                    .filter((record) => record.startsWith('did='))
                    .map((record) => record.slice('did='.length).trim()),
            );
        } catch (err) {
            const code = (err as NodeJS.ErrnoException)?.code ?? 'UNKNOWN';

            if (DNS_NO_RECORD_CODES.has(code)) {
                return ok([]);
            }

            this.logger.warn('Failed to resolve atproto DNS record', {
                domain,
                code,
            });

            return error({ type: 'dns-error', code });
        }
    }

    /**
     * Get the DID served at `https://<domain>/.well-known/atproto-did`, or
     * null if there isn't one (including when the request fails)
     *
     * Redirects are followed, as atproto resolvers do, but only to HTTPS URLs
     * on public addresses: the domain is set by whoever runs the site, so it
     * must not be able to point this service at internal addresses
     */
    async resolveHttps(domain: string): Promise<string | null> {
        const signal = AbortSignal.timeout(3000);
        let url = new URL(`https://${domain}/.well-known/atproto-did`);

        try {
            for (let hop = 0; hop <= MAX_WELL_KNOWN_REDIRECTS; hop++) {
                if (url.protocol !== 'https:') {
                    return null;
                }

                if (!allowPrivateAddress()) {
                    await validatePublicUrl(url.href);
                }

                const response = await fetch(url, {
                    redirect: 'manual',
                    signal,
                });

                if (response.status >= 300 && response.status < 400) {
                    const location = response.headers.get('location');

                    if (!location) {
                        return null;
                    }

                    url = new URL(location, url);
                    continue;
                }

                if (!response.ok) {
                    return null;
                }

                const did = (await response.text()).trim();

                return DID_PATTERN.test(did) ? did : null;
            }

            return null;
        } catch (err) {
            this.logger.info('Failed to resolve atproto well-known DID', {
                domain,
                error: err,
            });

            return null;
        }
    }
}
