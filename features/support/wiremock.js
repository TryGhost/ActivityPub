import { WireMock } from 'wiremock-captain';

/** @type {WireMock} */
let externalActivityPub;

/** @type {WireMock} */
let ghostActivityPub;

export function getExternalWiremock() {
    if (!externalActivityPub) {
        externalActivityPub = new WireMock('http://external-wiremock');
    }

    return externalActivityPub;
}

export function getGhostWiremock() {
    if (!ghostActivityPub) {
        ghostActivityPub = new WireMock('http://ghost-wiremock');
    }

    return ghostActivityPub;
}

export async function reset() {
    await Promise.all([
        getExternalWiremock().clearAllRequests(),
        getGhostWiremock().clearAllRequests(),
    ]);
}
