export async function wait(n) {
    return new Promise((resolve) => setTimeout(resolve, n));
}

export async function mapPostToActivityPubObject(post) {
    return {
        id: post.id,
        content: post.content,
        attachment:
            post.attachments && post.attachments.length > 0
                ? {
                      url: post.attachments[0].url,
                      type: post.attachments[0].type,
                  }
                : null,
    };
}

export function isInternalAccount(handle) {
    return handle.endsWith('.Internal');
}
