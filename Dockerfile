FROM node:24.19.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /opt/activitypub

RUN corepack enable

# All dependencies (prod + dev). Shared by the dev/test image and the build.
# pnpm-workspace.yaml holds the allowBuilds and minimumReleaseAgeExclude
# settings, so pnpm needs it present to resolve the lockfile.
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# Production-only dependencies, for the runtime image.
FROM base AS prod-deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --prod

# Image used by docker compose for local dev and the test suites. Also produces
# the bundle that the production image ships — `build:watch` needs dist/app.js
# to exist before it starts, so the bundle is baked in here either way.
FROM deps AS dev

COPY tsconfig.json vitest.config.ts ./
COPY src ./src

RUN pnpm build

EXPOSE 8080

CMD ["pnpm", "build:watch"]

FROM base AS production

ENV NODE_ENV=production

# package.json is needed at runtime for its `"type": "module"` — the bundle is ESM.
COPY package.json ./
COPY --from=prod-deps /opt/activitypub/node_modules ./node_modules
COPY --from=dev /opt/activitypub/dist ./dist

EXPOSE 8080

CMD ["node", "dist/app.js"]
