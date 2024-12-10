const SCALING_FACTOR = 1;

const NUM_SITES = Math.round(60_000 * SCALING_FACTOR);
const NUM_USERS = Math.round(300_000 * SCALING_FACTOR);
const NUM_ACCOUNTS = Math.round(2_500_000 * SCALING_FACTOR);
const NUM_POSTS = Math.round(3_000_000 * SCALING_FACTOR);

module.exports = {
    SCALING_FACTOR,
    NUM_SITES,
    NUM_USERS,
    NUM_ACCOUNTS,
    NUM_POSTS,
};
