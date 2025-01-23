import { AsyncLocalStorage } from 'node:async_hooks';
import type { FedifyRequestContext } from 'app';

export class FedifyContextFactory {
    private asyncLocalStorage = new AsyncLocalStorage<FedifyRequestContext>();

    getFedifyContext(): FedifyRequestContext {
        const context = this.asyncLocalStorage.getStore();
        if (context === undefined) {
            throw new Error(
                'Cannot call getFedifyContext before registerContext',
            );
        }

        return context;
    }

    registerContext(
        context: FedifyRequestContext,
        fn: (...args: unknown[]) => unknown,
    ) {
        return this.asyncLocalStorage.run(context, fn);
    }
}
