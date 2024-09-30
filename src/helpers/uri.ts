export function isUri(value: string): boolean {
    try {
        new URL(value);

        return true;
    } catch (err) {
        return false;
    }
}
