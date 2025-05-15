FROM node:20.19.2-alpine

WORKDIR /opt/job

COPY package.json .
COPY yarn.lock .

RUN yarn && yarn cache clean

COPY index.mjs .

ENTRYPOINT ["node", "index.mjs"]
CMD []
