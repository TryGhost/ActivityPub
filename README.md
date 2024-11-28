&nbsp;
<p align="center">
  <a href="https://ghost.org/#gh-light-mode-only" target="_blank">
    <img src="https://user-images.githubusercontent.com/65487235/157884383-1b75feb1-45d8-4430-b636-3f7e06577347.png" alt="Ghost" width="200px">
  </a>
  <a href="https://ghost.org/#gh-dark-mode-only" target="_blank">
    <img src="https://user-images.githubusercontent.com/65487235/157849205-aa24152c-4610-4d7d-b752-3a8c4f9319e6.png" alt="Ghost" width="200px">
  </a>
</p>
&nbsp;

# ActivityPub 🚧

A multitenant ActivityPub server for [Ghost](https://ghost.org/), built with [Fedify](https://fedify.dev/). This service makes it possible for independent websites to publish their content directly to the Fediverse, enabling networked publishing to the open social web.

This repository is being actively developed and is currently in early alpha - expect many breaking changes. It is not suitable for production use. 

## Subscribe to updates
We're publishing a weekly build-log about the development of this project. Sign up on [https://activitypub.ghost.org](https://activitypub.ghost.org)

[![image](https://github.com/TryGhost/ActivityPub/assets/120485/b341451c-3281-43b8-a6df-e7e34d75f9b5)](https://activitypub.ghost.org)

&nbsp;

# How it works

All requests to `/.ghost/activitypub/*`, `/.well-known/webfinger` and `/.well-known/nodeinfo` are proxied to this ActivityPub service using nginx. All other requests are forwarded to Ghost.

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

This has only been tested on macOS using [Docker for Mac](https://docs.docker.com/desktop/install/mac-install/) and [OrbStack](https://orbstack.dev/).

## Setup

1. **[Install Ghost](https://ghost.org/docs/install/)**
    - Ensure Ghost is running locally at `localhost:2368`
2. **Proxy with [Tailscale](https://tailscale.com/kb/1080/cli?q=cli)** (or [ngrok](https://ngrok.com/))
    - Use `tailscale funnel 80` or `ngrok http 80` to expose your local port 80
3. **Configure Ghost**
    - Run `ghost config url` and set it to the URL provided by Tailscale
4. **Start the ActivityPub Service**
    - Run `yarn dev` in the root directory of this project
5. **Open Ghost Admin**
    - Access your Ghost instance via the URL provided by Tailscale
6. **Enable ActivityPub Alpha**
    - Enable the ActivityPub Alpha flag in Settings &rarr; Labs
7. **Restart Ghost**
    - This will do the handshake between Ghost and ActivityPub to setup webhooks and Actor data


## Code formatting + linting

We use [Biome](https://biomejs.dev/) for code formatting and linting.

If you use VS Code, you can install the [Biome extension](https://marketplace.visualstudio.com/items?itemName=biomejs.biome) to get inline feedback.

To enable auto-formatting on save, you'll need to set the [default formatter](https://biomejs.dev/reference/vscode/#default-formatter) to `Biome` and enable [`Format on Save`](https://biomejs.dev/reference/vscode/#format-on-save) in your VS Code settings.

## Running Tests

- Run `yarn test` to execute tests within a Docker Compose stack.

## Populating the DB

The below command will populate the DB with ~5000 followers for the `activitypub` host

- Run `docker compose run scripts populate-activitypub-db`

## Migrations

`docker compose run migrate` or `docker compose run migrate-testing` will run the `up` migrations against your dev or testing db respectively.

If you would like to run other commands you can run `docker compose exec -it migrate /bin/bash` or `docker compose exec -it migrate-testing /bin/bash` - This will drop you into a shell with the `migrate` binary available as well as a `MYSQL_DB` environment variable that is correctly formated for use as the `-database` argument to the `migrate` binary

&nbsp;

# Community leaderboard

![Leaderboard](https://github.com/TryGhost/ActivityPub/assets/115641230/371e8f36-8293-43d2-912a-772e56517e1d)

&nbsp;

# Copyright & license

Copyright (c) 2013-2024 Ghost Foundation - Released under the [MIT license](LICENSE). Ghost and the Ghost Logo are trademarks of Ghost Foundation Ltd. Please see our [trademark policy](https://ghost.org/trademark/) for info on acceptable usage.

