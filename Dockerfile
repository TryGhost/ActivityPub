FROM node:22.17.0-alpine@sha256:5340cbfc2df14331ab021555fdd9f83f072ce811488e705b0e736b11adeec4bb

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

EXPOSE 8080

CMD ["node", "dist/app.js"]
