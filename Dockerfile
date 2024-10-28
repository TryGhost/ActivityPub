FROM node:20.18.0-alpine

WORKDIR /opt/activitypub

COPY package.json .
COPY yarn.lock .

RUN yarn && \
    yarn cache clean

COPY tsconfig.json .

COPY src ./src

EXPOSE 8080

CMD ["node", "--import", "tsx", "src/app.ts"]
