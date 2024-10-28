import {
    isActor,
    Actor,
    Context,
    Object as APObject,
} from '@fedify/fedify';
import { ContextData } from './app';
import { logging } from './logging';

export async function lookupActor(ctx: Context<ContextData>, url: string): Promise<Actor | null> {
    try {
        logging.info('Looking up actor locally {url})', { url });
        const local = await ctx.data.globaldb.get([url]);
        const object = await APObject.fromJsonLd(local);
        if (isActor(object)) {
            return object;
        }
        return null;
    } catch (err) {
        logging.error('Error looking up actor locally ({url}): {error}', { url, error: err });
        logging.info('Looking up actor remotely ({url})', { url });
        const documentLoader = await ctx.getDocumentLoader({handle: 'index'});
        try {
            const remote = await ctx.lookupObject(url, {documentLoader});
            if (isActor(remote)) {
                await ctx.data.globaldb.set([url], await remote.toJsonLd());
                return remote;
            }
        } catch (err) {
            logging.error('Error looking up actor remotely ({url}): {error}', { url, error: err });
            return null;
        }
    }
    return null;
}
