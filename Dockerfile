FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS base

WORKDIR /opt/activitypub

# Node 25+ images no longer ship corepack, so npm installs pnpm at the version
# packageManager names in package.json. That keeps a single pnpm pin for
# Renovate to move.
# A separate stage keeps the binary out of the production image.
FROM base AS pnpm

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN --mount=type=bind,source=package.json,target=/tmp/package.json \
    npm install --global --ignore-scripts \
    "$(node -p "require('/tmp/package.json').packageManager")"

# All dependencies (prod + dev). Shared by the dev/test image and the build.
# pnpm-workspace.yaml holds the allowBuilds and minimumReleaseAgeExclude
# settings, so pnpm needs it present to resolve the lockfile.
FROM pnpm AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# Production-only dependencies, for the runtime image.
FROM pnpm AS prod-deps

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
