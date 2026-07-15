FROM docker.io/library/debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818
ARG TARGETARCH

RUN apt-get update -y && \
    apt-get install -y curl && \
    rm -rf /var/lib/apt/lists/* && \
    curl -fsSL -O https://github.com/golang-migrate/migrate/releases/download/v4.17.1/migrate.linux-${TARGETARCH}.tar.gz && \
    curl -fsSL -O https://github.com/golang-migrate/migrate/releases/download/v4.17.1/sha256sum.txt && \
    grep " migrate.linux-${TARGETARCH}.tar.gz$" sha256sum.txt | sha256sum -c - && \
    tar xvzf migrate.linux-${TARGETARCH}.tar.gz migrate && \
    rm migrate.linux-${TARGETARCH}.tar.gz sha256sum.txt && \
    mv migrate /usr/bin/

COPY bin /usr/local/bin

COPY ./migrations /migrations

ENV MYSQL_DB=""

CMD ["up"]
