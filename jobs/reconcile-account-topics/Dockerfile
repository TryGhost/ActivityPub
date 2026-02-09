FROM oven/bun:1.3.9-alpine@sha256:9028ee7a60a04777190f0c3129ce49c73384d3fc918f3e5c75f5af188e431981

WORKDIR /opt/job

COPY index.ts .
COPY lib ./lib

ENTRYPOINT ["bun", "run", "index.ts"]
CMD []
