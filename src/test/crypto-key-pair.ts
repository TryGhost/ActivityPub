import { generateCryptoKeyPair } from '@fedify/fedify';

let cachedKeyPairs: Promise<CryptoKeyPair[]> | null = null;

export async function generateTestCryptoKeyPair() {
    if (cachedKeyPairs !== null) {
        return cachedKeyPairs;
    }

    cachedKeyPairs = (async () => {
        const ed25519Keys = await generateCryptoKeyPair('Ed25519');
        const rsaKeys = await generateCryptoKeyPair('RSASSA-PKCS1-v1_5');
        return [ed25519Keys, rsaKeys];
    })();

    return cachedKeyPairs;
}
