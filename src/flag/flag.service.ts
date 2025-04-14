export class FlagService {
    private flags: Map<string, boolean> = new Map();

    constructor(flags: string[]) {
        for (const flag of flags) {
            this.flags.set(flag, false);
        }
    }

    public enable(flag: string): void {
        this.flags.set(flag, true);
    }

    public isEnabled(flag: string): boolean {
        return this.flags.get(flag) ?? false;
    }

    public getRegistered(): string[] {
        return Array.from(this.flags.keys());
    }
}
