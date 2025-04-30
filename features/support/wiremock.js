import { WireMock } from 'wiremock-captain';

/** @type {WireMock} */
let externalActivityPub;

/** @type {WireMock} */
let ghostActivityPub;

export function getExternalActivityPub() {
    if (!externalActivityPub) {
        externalActivityPub = new WireMock(
            process.env.URL_EXTERNAL_ACTIVITY_PUB,
        );
    }

    return externalActivityPub;
}

export function getGhostActivityPub() {
    if (!ghostActivityPub) {
        ghostActivityPub = new WireMock(process.env.URL_GHOST_ACTIVITY_PUB);
    }

    return ghostActivityPub;
}

export function reset() {
    getExternalActivityPub().clearAllRequests();
    getGhostActivityPub().clearAllRequests();
}
