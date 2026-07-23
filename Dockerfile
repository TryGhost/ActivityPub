FROM node:22.23.1-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2

RUN apk add python3 g++ make
RUN apk add --no-cache ca-certificates

WORKDIR /opt/activitypub

RUN corepack enable

COPY package.json .
COPY pnpm-lock.yaml .

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json .

COPY src ./src
COPY vitest.config.ts vitest.config.ts

ENV NODE_ENV=production
RUN pnpm build

RUN apk del python3 g++ make

EXPOSE 8080

CMD ["node", "dist/app.js"]
