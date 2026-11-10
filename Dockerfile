FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS base

WORKDIR /opt/activitypub

# Node 25+ images no longer ship corepack, so pnpm comes from its own image.
# Keep the tag in step with packageManager in package.json (CI checks this).
# A separate stage keeps the binary out of the production image.
FROM base AS pnpm

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

COPY --from=ghcr.io/pnpm/pnpm:12.18.0-alpine@sha256:937d5b248145cd59aaf3d78dd0fd45f95e65b942585c370a0a11d53ab937ed98 /opt/pnpm /opt/pnpm
RUN ln -s /opt/pnpm/pnpm /usr/local/bin/pnpm

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
