FROM node:20.18.0-alpine

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

RUN echo "console.time('startup');" | cat - dist/app.js > dist/app.tmp.js && mv dist/app.tmp.js dist/app.js

CMD ["node", "dist/app.js"]
