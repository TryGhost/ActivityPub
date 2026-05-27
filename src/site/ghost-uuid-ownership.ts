import { HTTPError, TimeoutError } from 'ky';

import type { SiteSettings } from '@/helpers/ghost';

/**
 * The outcome of asking a previously-registered host whether it still
 * claims a given `ghost_uuid`.
 *
 * - `still-claims`: the host responded definitively that it still owns
 *   the UUID. The new registration must be refused.
 * - `released`: we have a definitive signal that the host has given up
 *   the UUID (or never genuinely held it). The new registration may
 *   proceed.
 * - `unverifiable`: we cannot determine ownership from the response.
 *   The policy layer decides what to do (currently: fail-open).
 */
export type OwnershipCheckResult =
    | { type: 'still-claims' }
    | { type: 'released'; reason: ReleaseReason }
    | { type: 'unverifiable'; reason: UnverifiableReason };

export type ReleaseReason =
    | 'dns-not-found'
    | 'connection-refused'
    | 'admin-api-gone'
    | 'non-ghost-response'
    | 'different-uuid'
    | 'aliased';

export type UnverifiableReason =
    | 'network-error'
    | 'timeout'
    | 'server-error'
    | 'unknown';

type SettingsFetcher = (host: string) => Promise<SiteSettings>;

/**
 * Classify whether a previously-registered host still claims a given
 * `ghost_uuid`, by fetching its admin site settings and inspecting the
 * outcome.
 *
 * This is best-effort verification against the host itself. It cannot
 * authoritatively prove ownership — for that, we would need to check
 * against Ghost(Pro)'s own records, which is tracked separately.
 */
export async function classifyGhostUuidOwnership(
    host: string,
    expectedUuid: string,
    fetchSettings: SettingsFetcher,
): Promise<OwnershipCheckResult> {
    let settings: SiteSettings;

    try {
        settings = await fetchSettings(host);
    } catch (err) {
        return classifyError(err);
    }

    if (!settings?.site?.site_uuid) {
        return { type: 'released', reason: 'different-uuid' };
    }

    if (settings.site.site_uuid === expectedUuid) {
        // The previous host still serves a matching UUID, but Ghost
        // reports a different host as the install's canonical URL.
        // This is the common pattern for managed Ghost hosting (e.g.
        // a provider's backend hostname aliased to a customer's
        // custom domain): both hostnames serve the same install, but
        // the install considers the custom domain its public identity.
        // Treat the previous host as having released the UUID so the
        // new (canonical) host can take it.
        if (canonicalUrlPointsElsewhere(settings.site.url, host)) {
            return { type: 'released', reason: 'aliased' };
        }
        return { type: 'still-claims' };
    }

    return { type: 'released', reason: 'different-uuid' };
}

/**
 * Returns true when the Ghost-reported canonical URL's host does not
 * match the host we queried. A null/malformed `url` returns false
 * (we conservatively keep treating the response as authoritative).
 */
function canonicalUrlPointsElsewhere(
    canonicalUrl: string | null,
    queriedHost: string,
): boolean {
    if (!canonicalUrl) {
        return false;
    }

    let canonicalHost: string;
    try {
        canonicalHost = new URL(canonicalUrl).host;
    } catch {
        return false;
    }

    return canonicalHost !== queriedHost;
}

function classifyError(err: unknown): OwnershipCheckResult {
    if (err instanceof TimeoutError) {
        return { type: 'unverifiable', reason: 'timeout' };
    }

    if (err instanceof HTTPError) {
        return classifyHttpStatus(err);
    }

    // Parsing failures on a 2xx body (`ky.json()` throws `SyntaxError`)
    // mean the host returned something that isn't a Ghost admin API
    // response, so it is not actively claiming the UUID.
    if (err instanceof SyntaxError) {
        return { type: 'released', reason: 'non-ghost-response' };
    }

    // Network-layer failures from ky 1.x surface as the underlying
    // `TypeError: fetch failed` from undici, with a system error code
    // (e.g. ENOTFOUND, ECONNREFUSED) nested in the cause chain.
    if (err instanceof Error) {
        const code = getNetworkErrorCode(err);
        // ENOTFOUND is a definitive "no DNS record exists" response.
        // EAI_AGAIN is a transient resolver failure (e.g. upstream
        // resolver timeout) and does not prove the host is gone.
        if (code === 'ENOTFOUND') {
            return { type: 'released', reason: 'dns-not-found' };
        }
        if (code === 'ECONNREFUSED') {
            return { type: 'released', reason: 'connection-refused' };
        }
        if (code !== undefined) {
            return { type: 'unverifiable', reason: 'network-error' };
        }
    }

    return { type: 'unverifiable', reason: 'unknown' };
}

function classifyHttpStatus(err: HTTPError): OwnershipCheckResult {
    const status = err.response.status;

    if (status >= 400 && status < 500) {
        return { type: 'released', reason: 'admin-api-gone' };
    }

    if (status >= 500) {
        return { type: 'unverifiable', reason: 'server-error' };
    }

    return { type: 'unverifiable', reason: 'unknown' };
}

/**
 * Walk the `cause` chain looking for a system error code like
 * `ENOTFOUND` or `ECONNREFUSED`. The error structure varies between
 * Node versions and HTTP libraries: the code may be on the error
 * itself, on `err.cause`, or nested deeper.
 */
function getNetworkErrorCode(err: Error): string | undefined {
    let current: unknown = err;

    for (let depth = 0; depth < 4 && current; depth++) {
        if (
            typeof current === 'object' &&
            current !== null &&
            'code' in current
        ) {
            const code = (current as { code?: unknown }).code;
            if (typeof code === 'string') {
                return code;
            }
        }
        current =
            typeof current === 'object' &&
            current !== null &&
            'cause' in current
                ? (current as { cause?: unknown }).cause
                : undefined;
    }

    return undefined;
}
