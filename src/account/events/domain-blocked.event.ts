export class DomainBlockedEvent {
    constructor(
        private readonly domain: URL,
        private readonly blockerId: number,
    ) {}

    getDomain(): URL {
        return this.domain;
    }

    getBlockerId(): number {
        return this.blockerId;
    }

    getName(): string {
        return 'domain.blocked';
    }

    static getName(): string {
        return 'domain.blocked';
    }
}
