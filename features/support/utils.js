export async function wait(n) {
    return new Promise((resolve) => setTimeout(resolve, n));
}

export async function mapPostToActivityPubObject(post) {
    return {
        id: post.id,
        content: post.content,
        attachment: post.featureImageUrl
            ? {
                  url: post.featureImageUrl,
                  type: 'Image',
              }
            : null,
    };
}
