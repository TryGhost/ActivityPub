import { AsyncLocalStorage } from 'node:async_hooks';

export class FlagService {
    private flags: Set<string>;
    private store: AsyncLocalStorage<Set<string>>;

    constructor(flags: string[]) {
        this.flags = new Set(flags);
        this.store = new AsyncLocalStorage<Set<string>>();
    }

    public async runInContext<T>(fn: () => Promise<T>) {
        return this.store.run(new Set<string>(), fn);
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

    public isDisabled(flag: string) {
        return !this.isEnabled(flag);
    }

    public getRegistered() {
        return Array.from(this.flags);
    }
}
