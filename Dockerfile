FROM node:lts-alpine

WORKDIR /opt/activitypub

COPY package.json .
COPY yarn.lock .

RUN yarn

COPY tsconfig.json .

COPY src ./src

EXPOSE 8080

CMD ["node", "--import", "tsx", "src/app.ts"]
