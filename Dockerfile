FROM node:22.22.2-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f

RUN apk add python3 g++ make
RUN apk add --no-cache ca-certificates

WORKDIR /opt/activitypub

COPY package.json .
COPY yarn.lock .

RUN yarn --ignore-scripts && \
    yarn cache clean

COPY tsconfig.json .

COPY src ./src
COPY vitest.config.ts vitest.config.ts

ENV NODE_ENV=production
RUN yarn build

RUN apk del python3 g++ make

EXPOSE 8080

CMD ["node", "dist/app.js"]
