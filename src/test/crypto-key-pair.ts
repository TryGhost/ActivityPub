import { generateCryptoKeyPair } from '@fedify/fedify';

let cachedKeyPair: Promise<CryptoKeyPair> | null = null;

export async function generateTestCryptoKeyPair() {
    if (cachedKeyPair !== null) {
        return cachedKeyPair;
    }

    cachedKeyPair = generateCryptoKeyPair();

    return cachedKeyPair;
}
