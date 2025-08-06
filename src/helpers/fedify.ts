import type { Federation } from '@fedify/fedify';

import type { ContextData } from '@/app';

export function createFedifyCtxForHost(
    fedify: Federation<ContextData>,
    host: string,
    ctxData: ContextData,
) {
    let hostUrl: URL;

    try {
        hostUrl = new URL(`https://${host}`);
    } catch (error) {
        throw new Error(`Invalid host URL: https://${host}`);
    }

    return fedify.createContext(hostUrl, {
        globaldb: ctxData.globaldb,
        logger: ctxData.logger,
    });
}
