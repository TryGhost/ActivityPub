import { BaseEntity } from '../core/base.entity';

export class Mention extends BaseEntity {
    constructor(
        public readonly id: number,
        public readonly postId: number,
        public readonly accountId: number,
    ) {
        super(id);
    }
}
