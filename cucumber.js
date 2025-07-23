// https://github.com/cucumber/cucumber-js/blob/main/docs/configuration.md

export default {
    backtrace: true,
    format: ['snippets'],
    formatOptions: {
        snippetInterface: 'async-await',
    },
    failFast: false,
    // @see https://github.com/cucumber/cucumber-js/blob/main/docs/filtering.md#tags
    tags: process.env.TAGS,
};
