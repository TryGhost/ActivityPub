import type { Context as HonoContext, Next } from 'hono';

const HEADER_PULL_REQUEST_ID = 'X-ActivityPub-PR';
const HEADER_COMMIT_SHA = 'X-ActivityPub-Commit';

export function createDeploymentHeadersMiddleware(environment: string) {
    return async function deploymentHeadersMiddleware(
        ctx: HonoContext,
        next: Next,
    ) {
        await next();

        if (environment === 'staging') {
            const pullRequestId = ctx.req.header(HEADER_PULL_REQUEST_ID);

            if (pullRequestId) {
                ctx.res.headers.set(HEADER_PULL_REQUEST_ID, pullRequestId);
            }

            const commitSha = ctx.req.header(HEADER_COMMIT_SHA);

            if (commitSha) {
                ctx.res.headers.set(HEADER_COMMIT_SHA, commitSha);
            }
        }
    };
}
