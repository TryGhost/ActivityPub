/**
 * Splits a string like `Create(Note)` or `Like(A)` into its activity and object parts
 *
 * @param {string} string
 *
 * @returns {{activity: string, object: string} | {activity: null, object: null}}
 */
export function parseActivityString(string) {
    const [match, activity, object] = string.match(/(\w+)\((.+)\)/) || [null];
    if (!match) {
        return {
            activity: null,
            object: null,
        };
    }
    return {
        activity,
        object,
    };
}

/**
 * Splits a string like `Person(Alice)` or `Group(Wonderland)` into its type and name parts
 *
 * @param {string} string
 *
 * @returns {{type: string, name: string} | {type: null, name: null}}
 */
export function parseActorString(string) {
    const [match, type, name] = string.match(/(\w+)\((.+)\)/) || [null];
    if (!match) {
        return {
            type: null,
            name: null,
        };
    }
    return {
        type,
        name,
    };
}
