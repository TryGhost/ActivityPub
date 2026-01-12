import type { Federation } from '@fedify/fedify';

import type { FedifyContextData } from '@/app';

export function createFedifyCtxForHost(
    fedify: Federation<FedifyContextData>,
    host: string,
    ctxData: FedifyContextData,
) {
    let hostUrl: URL;

    try {
        hostUrl = new URL(`https://${host}`);
    } catch (_error) {
        throw new Error(`Invalid host URL: https://${host}`);
    }

    return fedify.createContext(hostUrl, ctxData);
}
