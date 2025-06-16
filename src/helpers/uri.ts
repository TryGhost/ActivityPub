export function isUri(value: string): boolean {
    try {
        new URL(value);

        return true;
    } catch (err) {
        return false;
    }
}

export function toURL(value: unknown): URL | undefined {
    if (value instanceof URL) {
        return value;
    }
    if (typeof value !== 'string') {
        return undefined;
    }
    try {
        return new URL(value);
    } catch (err) {
        return undefined;
    }
}

/**
 * Compares two URLs or strings for equality, normalizing them by removing trailing slashes
 */
export function isEqual(a: URL | string, b: URL | string): boolean {
    if (a instanceof URL) return isEqual(a.href, b);
    if (b instanceof URL) return isEqual(a, b.href);

    return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}
