import EventEmitter from 'node:events';

export class AsyncEvents extends EventEmitter {
    // TODO: Clean up the any type
    // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
    async emitAsync(eventName: string, ...args: any[]): Promise<boolean> {
        const handlers = this.listeners(eventName);
        if (handlers.length === 0) {
            return false;
        }
        const promises = handlers.map(async (handler) => {
            return handler(...args);
        });
        await Promise.all(promises);
        return true;
    }
}
