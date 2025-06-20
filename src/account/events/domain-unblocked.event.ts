export class DomainUnblockedEvent {
    constructor(
        private readonly domain: URL,
        private readonly unblockerId: number,
    ) {}

    getDomain(): URL {
        return this.domain;
    }

    getUnblockerId(): number {
        return this.unblockerId;
    }

    getName(): string {
        return 'domain.unblocked';
    }

    static getName(): string {
        return 'domain.unblocked';
    }
}
