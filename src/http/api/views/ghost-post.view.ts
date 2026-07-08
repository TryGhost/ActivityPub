import type { Knex } from 'knex';

export class GhostPostView {
    constructor(private readonly db: Knex) {}

    /**
     * Get the AP id of the post that was created from a Ghost post
     *
     * @param ghostUuid UUID of the Ghost post
     * @param accountId ID of the account the post belongs to
     */
    async getApIdByGhostUuid(
        ghostUuid: string,
        accountId: number,
    ): Promise<string | null> {
        const result = await this.db('ghost_ap_post_mappings')
            .select('posts.ap_id')
            .innerJoin(
                'posts',
                'posts.ap_id_hash',
                'ghost_ap_post_mappings.ap_id_hash',
            )
            .where('ghost_ap_post_mappings.ghost_uuid', ghostUuid)
            .where('posts.author_id', accountId)
            .whereNull('posts.deleted_at')
            .first();

        return result?.ap_id ?? null;
    }
}
