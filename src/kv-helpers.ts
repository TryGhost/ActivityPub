import { KvKey, KvStore } from '@fedify/fedify';

export function scopeKvKey(scope: KvKey, key: KvKey): KvKey {
    const [first, ...rest] = scope;
    return [first, ...rest, ...key];
}

export function scopeKvStore(db: KvStore, scope: KvKey): KvStore {
    return {
        get(key: KvKey) {
            return db.get(scopeKvKey(scope, key));
        },
        set(key: KvKey, value: unknown) {
            return db.set(scopeKvKey(scope, key), value);
        },
        delete(key: KvKey) {
            return db.delete(scopeKvKey(scope, key));
        },
    };
}

export async function addToList(db: KvStore, key: KvKey, item: unknown) {
    const list = await db.get(key);
    if (!list || !Array.isArray(list)) {
        await db.set(key, []);
        return addToList(db, key, item);
    }
    await db.set(key, list.concat(item));
}

export async function removeFromList(db: KvStore, key: KvKey, item: unknown) {
    const list = await db.get(key);
    if (!list || !Array.isArray(list)) {
        await db.set(key, []);
        return;
    }
    await db.set(
        key,
        list.filter((listItem) => listItem !== item),
    );
}
