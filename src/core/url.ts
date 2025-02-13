export function parseURL(input: unknown): URL | null {
    try {
        return new URL(input as string | URL);
    } catch (err) {
        return null;
    }
}
