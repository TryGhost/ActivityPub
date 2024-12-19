FROM --platform=linux/amd64 node:22.12.0

WORKDIR /app

COPY package.json .

RUN npm install

COPY config.js .
COPY data-generate.sh .
COPY generate-data.js .
COPY generate-follows.js .
COPY generate-follows-worker.js .
COPY generate-feeds.js .
COPY generate-feeds-worker.js .

CMD ["/bin/bash", "data-generate.sh"]
