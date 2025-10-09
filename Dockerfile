FROM node:22.20.0-alpine@sha256:dbcedd8aeab47fbc0f4dd4bffa55b7c3c729a707875968d467aaaea42d6225af

RUN apk add python3 g++ make
RUN apk add --no-cache ca-certificates

WORKDIR /opt/activitypub

COPY package.json .
COPY yarn.lock .

RUN yarn && \
    yarn cache clean

COPY tsconfig.json .

COPY src ./src
COPY vitest.config.ts vitest.config.ts

ENV NODE_ENV=production
RUN yarn build

RUN apk del python3 g++ make

EXPOSE 8080

CMD ["node", "dist/app.js"]
