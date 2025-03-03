/**
 * Create a handler for a request to delete a post
 */
export function createDeletePostHandler() {
    /**
     * Handle a request to delete a post
     */
    return async function handleDeletePost() {
        return new Response(null, {
            status: 204,
        });
    };
}
