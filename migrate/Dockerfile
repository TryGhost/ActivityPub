FROM docker.io/library/debian:bookworm-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df
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
