FROM node:22.14-alpine@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile --production

# Copy source
COPY index.ts ./

CMD ["node", "--import", "tsx", "index.ts"]
