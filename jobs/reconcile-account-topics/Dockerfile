FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0

WORKDIR /opt/job

COPY package.json .
RUN bun install

COPY index.ts .
COPY lib ./lib

ENTRYPOINT ["bun", "run", "index.ts"]
CMD []
