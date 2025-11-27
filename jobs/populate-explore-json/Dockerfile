FROM node:22.16-alpine@sha256:41e4389f3d988d2ed55392df4db1420ad048ae53324a8e2b7c6d19508288107e

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --ignore-scripts --frozen-lockfile --production

# Copy source
COPY index.ts ./

CMD ["node", "--import", "tsx", "index.ts"]
