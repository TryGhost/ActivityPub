import type { Actor } from '@fedify/fedify';

import type { FedifyRequestContext } from '@/app';

/**
 * Resolves an ActivityPub actor
 *
 * @template TActor Type of actor to resolve
 */
export interface ActorResolver<TActor> {
    /**
     * Resolve an ActivityPub actor by their handle
     *
     * @param handle Handle of the actor to resolve
     */
    resolveActorByHandle(handle: string): Promise<TActor | null>;
}

/**
 * ActorResolver implementation using Fedify's RequestContext
 */
export class FedifyActorResolver implements ActorResolver<Actor> {
    constructor(private readonly fedifyCtx: FedifyRequestContext) {}

    async resolveActorByHandle(handle: string) {
        return this.fedifyCtx.getActor(handle);
    }
}
