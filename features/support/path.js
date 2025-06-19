import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function getCurrentDirectory() {
    return dirname(fileURLToPath(import.meta.url));
}
