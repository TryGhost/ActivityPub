import { AsyncLocalStorage } from 'node:async_hooks';

export class FlagService {
    private flags: Set<string>;
    private store: AsyncLocalStorage<Set<string>>;

    constructor(flags: string[]) {
        this.flags = new Set(flags);
        this.store = new AsyncLocalStorage<Set<string>>();
    }

    public initializeContext() {
        this.store.enterWith(new Set<string>());
    }

    public enable(flag: string) {
        if (!this.flags.has(flag)) {
            return;
        }

        const store = this.store.getStore();

        if (!store) {
            return;
        }

        store.add(flag);
    }

    public isEnabled(flag: string) {
        if (!this.flags.has(flag)) {
            return false;
        }

        const store = this.store.getStore();

        if (!store) {
            return false;
        }

        return store.has(flag);
    }

    public getRegistered() {
        return Array.from(this.flags);
    }
}
