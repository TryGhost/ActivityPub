import type { Knex } from 'knex';

export interface GetNotificationsDataOptions {
    /**
     * ID of the account associated with the user to get the notifications for
     */
    accountId: number;
    /**
     * Maximum number of notifications to return
     */
    limit: number;
    /**
     * Cursor to use for pagination
     */
    cursor: string | null;
}

interface BaseGetNotificationsDataResultRow {
    id: number;
}

export interface GetNotificationsDataResult {
    results: BaseGetNotificationsDataResultRow[];
    nextCursor: string | null;
}

export class NotificationService {
    /**
     * @param db Database client
     */
    constructor(private readonly db: Knex) {}

    /**
     * Get data for a notifications based on the provided options
     *
     * @param options Options for the query
     */
    async getNotificationsData(
        options: GetNotificationsDataOptions,
    ): Promise<GetNotificationsDataResult> {
        const { id: userId } = await this.db('users')
            .where('account_id', options.accountId)
            .select('id')
            .first();

        const results = await this.db('notifications')
            .where('user_id', userId)
            .limit(options.limit);

        // @TODO: Implement

        return {
            results: results.map((row) => ({ id: row.id })),
            nextCursor: null,
        };
    }
}
