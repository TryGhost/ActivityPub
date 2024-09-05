import {
    isActor,
    lookupObject,
    Actor,
    RequestContext,
    Object as APObject,
} from '@fedify/fedify';
import { ContextData } from './app';

export async function lookupActor(ctx: RequestContext<ContextData>, url: string): Promise<Actor | null> {
    try {
        console.log('Looking up actor locally', url);
        const local = await ctx.data.globaldb.get([url]);
        const object = await APObject.fromJsonLd(local);
        if (isActor(object)) {
            return object;
        }
        return null;
    } catch (err) {
        console.log('Error looking up actor locally', url);
        console.log(err);
        console.log('Looking up actor remotely', url);
        const documentLoader = await ctx.getDocumentLoader({handle: 'index'});
        try {
            const remote = await lookupObject(url, {documentLoader});
            if (isActor(remote)) {
                await ctx.data.globaldb.set([url], await remote.toJsonLd());
                return remote;
            }
        } catch (err) {
            console.log('Error looking up actor remotely', url);
            console.log(err)
            return null;
        }
    }
    return null;
}
