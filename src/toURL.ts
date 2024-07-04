export function toURL(x: unknown) {
    if (x instanceof URL) {
        return x;
    }
    if (typeof x !== 'string') {
        return undefined;
    }
    try {
        return new URL(x);
    } catch (err) {
        return undefined;
    }
}
