FROM node:22.22.3-alpine@sha256:9385cd9f3001dfc3431e8ead12c43e9e1f87cc1b9b5c6cfd0f73865d405b27c4

RUN apk add python3 g++ make
RUN apk add --no-cache ca-certificates

WORKDIR /opt/activitypub

COPY package.json .
COPY yarn.lock .

RUN yarn --ignore-scripts && \
    yarn cache clean

COPY tsconfig.json .

COPY src ./src
COPY vitest.config.ts vitest.config.ts

ENV NODE_ENV=production
RUN yarn build

RUN apk del python3 g++ make

EXPOSE 8080

CMD ["node", "dist/app.js"]
