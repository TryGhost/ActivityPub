FROM oven/bun:1.3.8-alpine@sha256:b0885548002187f088af5c7e04008f852c0a30cbe4192b5d75c3266a7f0b01f5

WORKDIR /opt/job

COPY index.ts .
COPY lib ./lib

ENTRYPOINT ["bun", "run", "index.ts"]
CMD []
