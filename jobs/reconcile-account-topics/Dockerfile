FROM oven/bun:1.4.2-alpine@sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f

WORKDIR /opt/job

COPY package.json .
RUN bun install

COPY index.ts .
COPY lib ./lib

ENTRYPOINT ["bun", "run", "index.ts"]
CMD []
