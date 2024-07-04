# ActivityPub 🚧

A multitenant ActivityPub server for [Ghost](https://ghost.org/), built with [Fedify](https://fedify.dev/). This service makes it possible for independent websites to publish their content directly to the Fediverse, enabling networked publishing to the open social web.

This repository is being actively developed and is currently in early alpha - expect many breaking changes. It is not suitable for production use. 

## Subscribe to updates
We're publishing a weekly build-log about the development of this project. Sign up on [https://activitypub.ghost.org](https://activitypub.ghost.org)

[![image](https://github.com/TryGhost/ActivityPub/assets/120485/b341451c-3281-43b8-a6df-e7e34d75f9b5)](https://activitypub.ghost.org)

&nbsp;

# How it works

All requests to `/.ghost/activitypub/*` and `/.well-known/webfinger` are proxied to this ActivityPub service using NGINX. All other requests are forwarded to Ghost.

## Current features

- [x] Follow
- [ ] Unfollow
- [x] Auto Accept Follows
- [ ] Manually Accept/Reject Follows
- [x] Publish Articles to Followers
- [x] Receive Articles in Inbox
- [x] Receive Notes in Inbox

&nbsp;

# Running locally for development

This has only been tested on MacOS using [Docker for Mac](https://docs.docker.com/desktop/install/mac-install/) and [OrbStack](https://orbstack.dev/).

## Setup

1. **[Install Ghost](https://ghost.org/docs/install/)**
    - Ensure Ghost is running locally at `localhost:2368`.
2. **Proxy with [Tailscale](https://tailscale.com/) ([ngrok](https://ngrok.com/) can also work)**
    - Use `tailscale funnel 80` or `ngrok http 80` to expose your local port 80.
3. **Configure Ghost**
    - Run `ghost config url` and set it to tthe URL provided by Tailscale
4. **Start the ActivityPub Service**
    - Run `yarn dev` in the root directory of this project
5. **Open Ghost Admin**
    - Access your Ghost instance via the URL provided by Tailscale
6. **[Configure a Webhook](https://ghost.org/integrations/custom-integrations/)**
    - Set up a webhook for the `post.published` event pointing to `https://<your-url>/.ghost/activitypub/webhooks/post/published`.
7. **Enable ActivityPub Alpha**
    - Enable the ActivityPub Alpha flag in Settings &rarr; Labs

## Running Tests

- Run `yarn test` to execute tests within a Docker Compose stack.


&nbsp;

# Copyright & license

Copyright (c) 2013-2023 Ghost Foundation - Released under the [MIT license](LICENSE). Ghost and the Ghost Logo are trademarks of Ghost Foundation Ltd. Please see our [trademark policy](https://ghost.org/trademark/) for info on acceptable usage.

