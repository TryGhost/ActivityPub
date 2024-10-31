import {
    Object as APObject,
    type Actor,
    type Context,
    isActor,
} from '@fedify/fedify';
import type { ContextData } from './app';

export async function lookupActor(ctx: Context<ContextData>, url: string): Promise<Actor | null> {
    try {
        ctx.data.logger.info('Looking up actor locally ({url})', { url });
        const local = await ctx.data.globaldb.get([url]);
        const object = await APObject.fromJsonLd(local);
        if (isActor(object)) {
            return object;
        }
        return null;
    } catch (err) {
        ctx.data.logger.error('Error looking up actor locally ({url}): {error}', { url, error: err });
        ctx.data.logger.info('Looking up actor remotely ({url})', { url });
        const documentLoader = await ctx.getDocumentLoader({handle: 'index'});
        try {
            const remote = await ctx.lookupObject(url, {documentLoader});
            if (isActor(remote)) {
                await ctx.data.globaldb.set([url], await remote.toJsonLd());
                return remote;
            }
        } catch (err) {
            ctx.data.logger.error('Error looking up actor remotely ({url}): {error}', { url, error: err });
            return null;
        }
    }
    return null;
}

export async function lookupObject(ctx: Context<ContextData>, identifier: string | URL) {
    let documentLoader = null;
    try {
        documentLoader = await ctx.getDocumentLoader({identifier: 'index'});
    } catch (err) {
        ctx.data.logger.warn("Could not get authenticated document loader for lookupObject");
    }
    if (documentLoader === null) {
        return ctx.lookupObject(identifier);
    }
        return ctx.lookupObject(identifier, {documentLoader});
}
