FROM --platform=linux/amd64 node:20.18.0-alpine

WORKDIR /opt/query-runner

COPY package.json .
COPY yarn.lock .

RUN yarn && \
    yarn cache clean

COPY tsconfig.json .

COPY queries ./queries

COPY src ./src

ENV NODE_ENV=production
RUN yarn build

EXPOSE 8080

CMD ["node", "dist/app.js"]
