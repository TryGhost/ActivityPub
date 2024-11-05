FROM node:20.18.0-alpine

WORKDIR /opt/activitypub

COPY package.json .
COPY yarn.lock .

RUN apk add --no-cache python3 make g++ && \
    yarn && \
    yarn cache clean && \
    apk del python3 make g++

COPY tsconfig.json .

COPY src ./src

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "--import", "tsx", "src/app.ts"]
