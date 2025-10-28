import type { Actor } from '@/integration/bluesky-api.client';

export const BRIDGY_FED_LABEL = 'bridged-from-bridgy-fed-activitypub';

export function findValidBridgyHandle(
    actors: Actor[],
    domain: string,
): string | null {
    // Find Bridgy Fed actors
    const bridgyActors = actors.filter((actor) => {
        if (!actor.labels) return false;

        return actor.labels.some((label) => label.val === BRIDGY_FED_LABEL);
    });

    // Normalize domain by stripping www. prefix if present
    const normalizedDomain = domain.startsWith('www.')
        ? domain.substring(4)
        : domain;

    // Find actors with a handle ending in .{domain}.ap.brid.gy
    const expectedHandleSuffix = `.${normalizedDomain}.ap.brid.gy`;

    const matchingActors = bridgyActors.filter((actor) =>
        actor.handle.endsWith(expectedHandleSuffix),
    );

    if (matchingActors.length === 0) {
        return null;
    }

    // Prefer handles that are not 'handle.invalid'
    const validActor =
        matchingActors.find((actor) => actor.handle !== 'handle.invalid') ||
        matchingActors[0];

    // If all matching actors have handle.invalid, return null
    if (validActor.handle === 'handle.invalid') {
        return null;
    }

    return validActor.handle;
}
