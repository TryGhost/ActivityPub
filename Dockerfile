FROM node:22.17.0-alpine@sha256:9db789c423efafd5e68fe6db7c10b45e6b3c4a5a8456e640d2e7da6581c701d3

WORKDIR /opt/activitypub

COPY package.json .
COPY yarn.lock .

RUN yarn && \
    yarn cache clean

COPY tsconfig.json .

COPY src ./src
COPY vitest.config.ts vitest.config.ts

ENV NODE_ENV=production
RUN yarn build

EXPOSE 8080

CMD ["node", "dist/app.js"]
