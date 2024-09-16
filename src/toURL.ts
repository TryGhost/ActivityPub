export function toURL(x: unknown) {
    if (x instanceof URL) {
        return x;
    }
    if (typeof x !== 'string') {
        return undefined;
    }
    try {
        return new URL(x);
    // eslint-disable-next-line
    } catch (err) {
        return undefined;
    }
}
