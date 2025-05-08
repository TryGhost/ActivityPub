export async function wait(n) {
    return new Promise((resolve) => setTimeout(resolve, n));
}

export async function mapPostToObject(post) {
    return {
        id: post.id,
        content: post.content,
    };
}
