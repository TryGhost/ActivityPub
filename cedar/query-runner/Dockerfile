FROM --platform=linux/amd64 node:20.18.0-alpine@sha256:b1e0880c3af955867bc2f1944b49d20187beb7afa3f30173e15a97149ab7f5f1

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
