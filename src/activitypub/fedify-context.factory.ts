import { AsyncLocalStorage } from 'node:async_hooks';
import type { FedifyContext } from '../app';

export class FedifyContextFactory {
    private asyncLocalStorage = new AsyncLocalStorage<FedifyContext>();

    getFedifyContext(): FedifyContext {
        const context = this.asyncLocalStorage.getStore();
        if (context === undefined) {
            throw new Error(
                'Cannot call getFedifyContext before registerContext',
            );
        }

        return context;
    }

    registerContext(
        context: FedifyContext,
        fn: (...args: unknown[]) => unknown,
    ) {
        return this.asyncLocalStorage.run(context, fn);
    }
}
