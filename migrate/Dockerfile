FROM debian:bookworm-slim@sha256:8f8e63bb364a33694362f38ee9a9e38b09eb9eb138584693800b87ca173bfd4a

RUN apt-get update -y && \
    apt-get install -y curl && \
    rm -rf /var/lib/apt/lists/* && \
    curl -L https://github.com/golang-migrate/migrate/releases/download/v4.17.1/migrate.linux-amd64.tar.gz | tar xvz && \
    mv migrate /usr/bin/

COPY bin /usr/local/bin

COPY ./migrations /migrations

ENV MYSQL_DB=""

CMD ["up"]
