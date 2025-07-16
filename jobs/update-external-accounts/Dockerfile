FROM node:22.17-alpine@sha256:9db789c423efafd5e68fe6db7c10b45e6b3c4a5a8456e640d2e7da6581c701d3

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile --production

# Copy source
COPY index.ts ./

# Run the update external accounts job
CMD ["node", "--import", "tsx", "index.ts"]
