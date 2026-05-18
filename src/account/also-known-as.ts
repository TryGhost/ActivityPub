export function parseAlsoKnownAs(value: string[] | string | null | undefined) {
    if (!value) {
        return [];
    }

    let parsed: unknown;

    try {
        parsed = typeof value === 'string' ? JSON.parse(value) : value;
    } catch (_err) {
        return [];
    }

    if (!Array.isArray(parsed)) {
        return [];
    }

    return parsed.reduce<URL[]>((aliases, item) => {
        if (typeof item !== 'string') {
            return aliases;
        }

        try {
            aliases.push(new URL(item));
        } catch (_err) {
            return aliases;
        }

        return aliases;
    }, []);
}
