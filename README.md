# ActivityPub V3 Final

A multitenant ActivityPub service built using the [Fedify](https://fedify.dev/) framework, designed to integrate seamlessly with [Ghost](https://ghost.org/). This service provides ActivityPub functionality for following other users and publishing to the fediverse. Ghost communicates with this service to manage all ActivityPub features.

**Note:** ⚠️ This project is in its early phases and not yet ready for production 

## How It Works

All requests to `/.ghost/activitypub/*` and `/.well-known/webfinger` are proxied to this ActivityPub service using NGINX. All other requests are forwarded to Ghost.

### Current Features

- [x] Follow
- [ ] Unfollow
- [x] Auto Accept Follows
- [ ] Manually Accept/Reject Follows
- [x] Publish Articles to Followers
- [x] Receive Articles in Inbox
- [x] Receive Notes in Inbox

## Running Locally / Development

You need `docker` installed - this has only been tested on MacOS using Docker for Mac and OrbStack.

### Setup Steps

1. **Set up a Ghost development environment**
    - Ensure Ghost is running locally at `localhost:2368`.
2. **Proxy your local environment**
    - Use `tailscale funnel 80` or `ngrok http 80` to expose your local port 80.
3. **Configure Ghost**
    - Set the URL in your Ghost config to the URL output by the above command.
4. **Start the ActivityPub Service**
    - Run `yarn dev` in the root directory of this project.
5. **Visit the Exposed URL**
    - Access your Ghost instance via the URL provided by Tailscale or Ngrok.
6. **Configure Webhook**
    - Set up a webhook for the `post.published` event pointing to `https://<your-url>/.ghost/activitypub/webhooks/post/published`.
7. **Enable ActivityPub Alpha**
    - Switch on the ActivityPub Alpha flag in Labs

### Running Tests

- Run `yarn test` to execute tests within a Docker Compose stack.

## Related Projects and Resources

- [Fedify](https://github.com/dahlia/fedify/)
- [Ghost](https://github.com/TryGhost/Ghost/)

# Copyright & License 

Copyright (c) 2013-2024 Ghost Foundation - Released under the [MIT license](LICENSE).
