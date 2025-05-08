export async function wait(n) {
    return new Promise((resolve) => setTimeout(resolve, n));
}

export async function mapPostToActivityPubObject(post) {
    return {
        id: post.id,
        content: post.content,
        attachment: post.attachments
            ? post.attachments.map((attachment) => ({
                  url: attachment.url,
                  type: attachment.type,
              }))
            : null,
    };
}
