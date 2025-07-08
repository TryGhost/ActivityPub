FROM node:22.17-alpine@sha256:10962e8568729b0cfd506170c5a2d1918a2c10ac08c0e6900180b4bac061adc9

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile --production

# Copy source
COPY index.ts ./

# Run the update external accounts job
CMD ["node", "--import", "tsx", "index.ts"]
