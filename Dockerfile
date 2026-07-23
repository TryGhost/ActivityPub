FROM node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

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

EXPOSE 8080

# Node 24's default heap ceiling (~50% of container memory) is too small for
# our working set and causes fatal heap OOMs; 75% leaves room for off-heap usage
CMD ["node", "--max-old-space-size-percentage=75", "dist/app.js"]
