import type { Object as FedifyObject } from '@fedify/fedify';

import type { FedifyRequestContext } from '@/app';

/**
 * Builds ActivityPub URIs
 *
 * @template TObject Type of object to build a URI for
 */
export interface UriBuilder<TObject> {
    /**
     * Build a URI for an object
     *
     * @param cls Class of the object to build a URI for
     * @param id ID of the object to build a URI for
     */
    buildObjectUri(
        cls: { new (props: Partial<TObject>): TObject; typeId: URL },
        id: string,
    ): URL;

    /**
     * Build a URI for an actor's followers collection
     *
     * @param handle Handle of the actor to build a followers collection URI for
     */
    buildFollowersCollectionUri(handle: string): URL;
}

/**
 * UriBuilder implementation using Fedify's RequestContext
 */
export class FedifyUriBuilder implements UriBuilder<FedifyObject> {
    constructor(private readonly fedifyCtx: FedifyRequestContext) {}

    buildObjectUri(
        cls: { new (props: Partial<FedifyObject>): FedifyObject; typeId: URL },
        id: string,
    ) {
        return this.fedifyCtx.getObjectUri(cls, { id });
    }

    buildFollowersCollectionUri(handle: string) {
        return this.fedifyCtx.getFollowersUri(handle);
    }
}
