FROM oven/bun:1.3.11-alpine@sha256:7ed9f74c326d1c260abe247ac423ccbf5ac92af62bb442d515d1f92f21e8ea9b

WORKDIR /opt/job

COPY package.json .
RUN bun install

COPY index.ts .
COPY lib ./lib

ENTRYPOINT ["bun", "run", "index.ts"]
CMD []
