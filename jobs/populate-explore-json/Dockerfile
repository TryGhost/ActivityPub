FROM node:22.14-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --production

# Copy source
COPY index.ts ./

# Install tsx to run TypeScript directly
RUN npm install -g tsx

# Run as non-root user
USER node

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]
CMD ["tsx", "index.ts"]
