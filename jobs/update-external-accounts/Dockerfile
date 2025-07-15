FROM node:22.17-alpine@sha256:0f2b9a8d6a7c915b006beeaf41c5675a3e92d7ba548bb9a42263a3cac1e15867

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile --production

# Copy source
COPY index.ts ./

# Run the update external accounts job
CMD ["node", "--import", "tsx", "index.ts"]
