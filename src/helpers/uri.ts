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
