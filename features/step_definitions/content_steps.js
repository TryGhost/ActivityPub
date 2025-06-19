import { Given } from '@cucumber/cucumber';
import { publishArticle, publishNote } from '../support/content.js';

Given('we publish an article', async function () {
    if (this.articleId) {
        throw new Error('This step does not support multiple articles');
    }

    const post = await publishArticle();

    this.articleId = post.id;
});

Given('we publish a note', async function () {
    if (this.noteId) {
        throw new Error('This step does not support multiple notes');
    }

    const post = await publishNote();

    this.noteId = post.id;
});
