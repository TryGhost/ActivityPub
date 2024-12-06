FROM node:22.12.0-alpine

WORKDIR /app

COPY package.json .

RUN npm install

COPY config.js .
COPY generate-data.js .
COPY generate-follows.js .
COPY generate-follows-worker.js .
COPY generate-feeds.js .
COPY generate-feeds-worker.js .

CMD ["node", "generate-data.js"]
