FROM node:20.18.0-alpine

RUN apk add --no-cache ca-certificates python3 build-base

WORKDIR /opt/activitypub

COPY package.json .
COPY yarn.lock .

RUN yarn && \
    yarn cache clean

COPY tsconfig.json .

COPY src ./src

ENV NODE_ENV=production
RUN yarn build

EXPOSE 8080

CMD ["node", "dist/app.js"]
