export async function wait(n) {
    return new Promise((resolve) => setTimeout(resolve, n));
}
