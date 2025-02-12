export abstract class BaseEntity {
    constructor(public id: number | null) {}

    get isNew(): boolean {
        return this.id === null;
    }
}
