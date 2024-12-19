// https://github.com/cucumber/cucumber-js/blob/main/docs/configuration.md

export default {
    backtrace: true,
    format: ['progress'],
    formatOptions: {
        snippetInterface: 'synchronous',
    },
    failFast: true,
    // @see https://github.com/cucumber/cucumber-js/blob/main/docs/filtering.md#tags
    tags: process.env.TAGS,
};
