FROM node:22.23.0-alpine@sha256:ab07539e0988b63558ff621f5fbe1077054c39d9809112974fb79993949d41cd

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
