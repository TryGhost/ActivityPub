FROM --platform=linux/amd64 node:22.12.0@sha256:0e910f435308c36ea60b4cfd7b80208044d77a074d16b768a81901ce938a62dc

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
