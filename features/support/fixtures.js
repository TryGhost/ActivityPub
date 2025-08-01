import fs from 'node:fs';
import { resolve } from 'node:path';

import { v4 as uuidv4 } from 'uuid';

import { getCurrentDirectory } from './path.js';
import { getExternalWiremock } from './wiremock.js';

function generateObject(type, content, tags = [], inReplyTo = null) {
    if (type === 'Article') {
        const uuid = uuidv4();
        return {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Article',
            id: `https://fake-external-activitypub.test/article/${uuid}`,
            url: `https://fake-external-activitypub.test/article/${uuid}`,
            to: 'as:Public',
            cc: 'https://fake-external-activitypub.test/followers',
            content: content ?? '<p>This is a test article</p>',
            published: new Date(),
            attributedTo: 'https://fake-external-activitypub.test/user',
            tag: tags,
            inReplyTo,
        };
    }

    if (type === 'Note') {
        const uuid = uuidv4();
        return {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Note',
            id: `https://fake-external-activitypub.test/note/${uuid}`,
            url: `https://fake-external-activitypub.test/note/${uuid}`,
            to: 'as:Public',
            cc: 'https://fake-external-activitypub.test/followers',
            content: content ?? '<p>This is a test note</p>',
            published: new Date(),
            attributedTo: 'https://fake-external-activitypub.test/user',
            tag: tags,
            inReplyTo,
        };
    }

    if (type === 'Accept') {
        const uuid = uuidv4();
        return {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Accept',
            id: `https://fake-external-activitypub.test/accept/${uuid}`,
            url: `https://fake-external-activitypub.test/accept/${uuid}`,
        };
    }
}

export async function createObject(
    type,
    actor,
    content,
    tags = [],
    inReplyTo = null,
) {
    if (typeof content === 'object') {
        return createObject(
            type,
            actor,
            content.content,
            content.tags,
            content.inReplyTo,
        );
    }
    const object = generateObject(type, content, tags, inReplyTo);

    if (!object) {
        throw new Error(`Cannot create objects of type ${type}`);
    }

    object.attributedTo = actor.id;

    const url = new URL(object.id);

    await getExternalWiremock().register(
        {
            method: 'GET',
            endpoint: url.pathname,
        },
        {
            status: 200,
            body: object,
            headers: {
                'Content-Type': 'application/activity+json',
            },
        },
    );

    return object;
}

export async function createActivity(type, object, actor) {
    let activity;

    if (type === 'Follow') {
        activity = {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Follow',
            id: `${process.env.URL_EXTERNAL_ACTIVITY_PUB}/follow/${uuidv4()}`,
            to: 'as:Public',
            object: object,
            actor: actor,
        };
    }

    if (type === 'Accept') {
        activity = {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Accept',
            id: `${process.env.URL_EXTERNAL_ACTIVITY_PUB}/accept/${uuidv4()}`,
            to: 'as:Public',
            object: object,
            actor: actor,
        };
    }

    if (type === 'Reject') {
        activity = {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Reject',
            id: `${process.env.URL_EXTERNAL_ACTIVITY_PUB}/reject/${uuidv4()}`,
            to: 'as:Public',
            object: object,
            actor: actor,
        };
    }

    if (type === 'Create') {
        activity = {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Create',
            id: `${process.env.URL_EXTERNAL_ACTIVITY_PUB}/create/${uuidv4()}`,
            to: 'as:Public',
            object: object,
            actor: actor,
        };
    }

    if (type === 'Announce') {
        activity = {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Announce',
            id: `${process.env.URL_EXTERNAL_ACTIVITY_PUB}/announce/${uuidv4()}`,
            to: 'as:Public',
            object: object,
            actor: actor,
        };
    }

    if (type === 'Like') {
        activity = {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Like',
            id: `${process.env.URL_EXTERNAL_ACTIVITY_PUB}/like/${uuidv4()}`,
            to: 'as:Public',
            object: object,
            actor: actor,
        };
    }

    if (type === 'Undo') {
        activity = {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Undo',
            id: `${process.env.URL_EXTERNAL_ACTIVITY_PUB}/undo/${uuidv4()}`,
            to: 'as:Public',
            object: object,
            actor: actor,
        };
    }

    if (type === 'Delete') {
        activity = {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Delete',
            id: `${process.env.URL_EXTERNAL_ACTIVITY_PUB}/delete/${uuidv4()}`,
            to: 'as:Public',
            object: object,
            actor: actor,
        };
    }

    const externalActivityPub = getExternalWiremock();

    await externalActivityPub.register(
        {
            method: 'GET',
            endpoint: activity.id.replace(
                process.env.URL_EXTERNAL_ACTIVITY_PUB,
                '',
            ),
        },
        {
            status: 200,
            body: activity,
            headers: {
                'Content-Type': 'application/activity+json',
            },
        },
    );

    return activity;
}

export async function createActor(
    name,
    { remote = true, type = 'Person' } = {},
) {
    if (remote === false) {
        return {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            id: 'https://self.test/.ghost/activitypub/users/index',
            url: 'https://self.test/.ghost/activitypub/users/index',
            type,

            handle: '@index@self.test',

            preferredUsername: 'index',
            name,
            summary: 'A test actor for testing',

            inbox: 'https://self.test/.ghost/activitypub/inbox/index',
            outbox: 'https://self.test/.ghost/activitypub/outbox/index',
            followers: 'https://self.test/.ghost/activitypub/followers/index',
            following: 'https://self.test/.ghost/activitypub/following/index',
            liked: 'https://self.test/.ghost/activitypub/liked/index',

            'https://w3id.org/security#publicKey': {
                id: 'https://self.test/.ghost/activitypub/users/index#main-key',
                type: 'https://w3id.org/security#Key',
                'https://w3id.org/security#owner': {
                    id: 'https://self.test/.ghost/activitypub/users/index',
                },
                'https://w3id.org/security#publicKeyPem':
                    '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtSc3IqGjRaO3vcFdQ15D\nF90WVJC6tb2QwYBh9kQYVlQ1VhBiF6E4GK2okvyvukIL5PHLCgfQrfJmSiopk9Xo\n46Qri6rJbcPoWoZz/jWN0pfmU20hNuTQx6ebSoSkg6rHv1MKuy5LmDGLFC2ze3kU\nsY8u7X6TOBrifs/N+goLaH3+SkT2hZDKWJrmDyHzj043KLvXs/eiyu50M+ERoSlg\n70uO7QAXQFuLMILdy0UNJFM4xjlK6q4Jfbm4MC8QRG+i31AkmNvpY9JqCLqu0mGD\nBrdfJeN8PN+7DHW/Pzspf5RlJtlvBx1dS8Bxo2xteUyLGIaTZ9HZFhHc3IrmmKeW\naQIDAQAB\n-----END PUBLIC KEY-----\n',
            },
        };
    }

    const user = {
        '@context': [
            'https://www.w3.org/ns/activitystreams',
            'https://w3id.org/security/data-integrity/v1',
        ],
        id: `https://fake-external-activitypub.test/user/${name}`,
        url: `https://fake-external-activitypub.test/user/${name}`,
        type,

        handle: `@${name}@fake-external-activitypub.test`,

        preferredUsername: name,
        name,
        summary: 'A test actor for testing',

        inbox: `https://fake-external-activitypub.test/inbox/${name}`,
        outbox: `https://fake-external-activitypub.test/inbox/${name}`,
        followers: `https://fake-external-activitypub.test/followers/${name}`,
        following: `https://fake-external-activitypub.test/following/${name}`,
        liked: `https://fake-external-activitypub.test/liked/${name}`,

        'https://w3id.org/security#publicKey': {
            id: 'https://fake-external-activitypub.test/user#main-key',
            type: 'https://w3id.org/security#Key',
            'https://w3id.org/security#owner': {
                id: 'https://fake-external-activitypub.test/user',
            },
            'https://w3id.org/security#publicKeyPem':
                '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtSc3IqGjRaO3vcFdQ15D\nF90WVJC6tb2QwYBh9kQYVlQ1VhBiF6E4GK2okvyvukIL5PHLCgfQrfJmSiopk9Xo\n46Qri6rJbcPoWoZz/jWN0pfmU20hNuTQx6ebSoSkg6rHv1MKuy5LmDGLFC2ze3kU\nsY8u7X6TOBrifs/N+goLaH3+SkT2hZDKWJrmDyHzj043KLvXs/eiyu50M+ERoSlg\n70uO7QAXQFuLMILdy0UNJFM4xjlK6q4Jfbm4MC8QRG+i31AkmNvpY9JqCLqu0mGD\nBrdfJeN8PN+7DHW/Pzspf5RlJtlvBx1dS8Bxo2xteUyLGIaTZ9HZFhHc3IrmmKeW\naQIDAQAB\n-----END PUBLIC KEY-----\n',
        },
    };

    const externalActivityPub = getExternalWiremock();

    await Promise.all([
        externalActivityPub.register(
            {
                method: 'POST',
                endpoint: `/inbox/${name}`,
            },
            {
                status: 202,
            },
        ),
        externalActivityPub.register(
            {
                method: 'GET',
                endpoint: `/user/${name}`,
            },
            {
                status: 200,
                body: user,
                headers: {
                    'Content-Type': 'application/activity+json',
                },
            },
        ),
        externalActivityPub.register(
            {
                method: 'GET',
                endpoint: `/followers/${name}`,
            },
            {
                status: 200,
                body: {
                    '@context': 'https://www.w3.org/ns/activitystreams',
                    type: 'OrderedCollection',
                    totalItems: 0,
                    orderedItems: [],
                },
                headers: {
                    'Content-Type': 'application/activity+json',
                },
            },
        ),
        externalActivityPub.register(
            {
                method: 'GET',
                endpoint: `/following/${name}`,
            },
            {
                status: 200,
                body: {
                    '@context': 'https://www.w3.org/ns/activitystreams',
                    type: 'OrderedCollection',
                    totalItems: 0,
                    orderedItems: [],
                },
                headers: {
                    'Content-Type': 'application/activity+json',
                },
            },
        ),
        externalActivityPub.register(
            {
                method: 'GET',
                endpoint: `/.well-known/webfinger?resource=${encodeURIComponent(`acct:${name}@fake-external-activitypub.test`)}`,
            },
            {
                status: 200,
                body: {
                    subject: `acct:${name}@fake-external-activitypub.test`,
                    aliases: [
                        `https://fake-external-activitypub.test/user/${name}`,
                    ],
                    links: [
                        {
                            rel: 'self',
                            href: `https://fake-external-activitypub.test/user/${name}`,
                            type: 'application/activity+json',
                        },
                        {
                            rel: 'http://webfinger.net/rel/profile-page',
                            href: 'https://activitypub.ghost.org/',
                        },
                        {
                            rel: 'http://webfinger.net/rel/avatar',
                            href: 'https://activitypub.ghost.org/content/images/2024/09/ghost-orb-white-squircle-07.png',
                        },
                    ],
                },
            },
        ),
    ]);

    return user;
}

export function createWebhookPost() {
    const uuid = uuidv4();

    return {
        post: {
            current: {
                uuid,
                title: 'Test Post',
                html: '<p>This is a test post</p>',
                excerpt: 'This is a test post',
                custom_excerpt: null,
                feature_image: null,
                published_at: new Date().toISOString(),
                url: `https://fake-external-activitypub.test/post/${uuid}`,
                visibility: 'public',
                authors: [
                    {
                        name: 'Testing',
                        profile_image: '//gravatar.com/avatar/blah',
                    },
                ],
            },
        },
    };
}

let webhookSecret;

export function getWebhookSecret() {
    if (!webhookSecret) {
        webhookSecret = fs.readFileSync(
            resolve(getCurrentDirectory(), '../fixtures/webhook_secret.txt'),
            'utf8',
        );
    }

    return webhookSecret;
}
