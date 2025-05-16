FROM node:20.19.2-alpine

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
