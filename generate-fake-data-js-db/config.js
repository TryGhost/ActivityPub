const SCALING_FACTOR = 0.1;

const NUM_SITES = 60_000 * SCALING_FACTOR;
const NUM_USERS = 300_000 * SCALING_FACTOR;
const NUM_ACCOUNTS = 2_500_000 * SCALING_FACTOR;
const NUM_POSTS = 3_000_000 * SCALING_FACTOR;

const DB_CONFIG = {
    host: process.env.MYSQL_HOST,
    port: process.env.MYSQL_PORT,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectionLimit: 50,
    multipleStatements: true,
};

module.exports = {
    SCALING_FACTOR,
    NUM_SITES,
    NUM_USERS,
    NUM_ACCOUNTS,
    NUM_POSTS,
    DB_CONFIG,
};
