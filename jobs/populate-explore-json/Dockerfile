FROM node:22.14-alpine

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile --production

# Copy source
COPY index.ts ./

CMD ["node", "--import", "tsx", "index.ts"]
