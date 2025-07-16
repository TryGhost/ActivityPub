FROM node:22.17-alpine@sha256:fc3e945f920b7e3000cd1af86c4ae406ec70c72f328b667baf0f3a8910d69eed

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile --production

# Copy source
COPY index.ts ./

# Run the update external accounts job
CMD ["node", "--import", "tsx", "index.ts"]
