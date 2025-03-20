FROM node:20.18.0-alpine

WORKDIR /opt/job

COPY package.json .
COPY yarn.lock .

RUN yarn && yarn cache clean

COPY index.mjs .

ENTRYPOINT ["node", "index.mjs"]
CMD []
